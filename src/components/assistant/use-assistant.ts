"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { mockBrain } from "@/lib/assistant/mock-brain";
import { pageContext } from "@/lib/assistant/page";
import { describeValue } from "@/lib/assistant/slots";
import { TOOLS, toolByName } from "@/lib/assistant/tools";
import type { AssistantBrain, ToolCallPart, ToolContext, ToolInput } from "@/lib/assistant/types";
import { createWorld } from "@/lib/assistant/world";
import { useActorName } from "@/lib/api/actor";
import { openCommandPalette } from "@/components/shell/palette-store";
import { DOCK_MEDIA, getAssistantState, newId, patchCall, pushMessage, pushPart, setBusy, setPending, setSheetOpen } from "./assistant-store";

/** The brain in use. A model-backed one implements the same interface (types.ts). */
const BRAIN: AssistantBrain = mockBrain;
/** A beat before the first reply, so an instant answer doesn't read as a page glitch. */
const THINK_MS = 280;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface AssistantController {
  brainLabel: string;
  ctx: ToolContext;
  send: (text: string) => Promise<void>;
  confirm: (messageId: string, callId: string) => Promise<void>;
  cancel: (messageId: string, callId: string) => void;
}

/**
 * Runs the conversation: sends each message to the brain, turns its events into chat parts,
 * runs read tools at once and holds the rest for Confirm. Tools get a ToolContext built from
 * the page (router, query cache, theme, "Acting as"), so they act exactly like the UI does.
 */
export function useAssistant(): AssistantController {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const { setTheme } = useTheme();
  const [actorName, setActorName] = useActorName();
  const world = useMemo(() => createWorld(qc), [qc]);

  const ctx = useMemo<ToolContext>(
    () => ({
      qc,
      world,
      page: pageContext(pathname),
      navigate: (href) => {
        router.push(href);
        // On narrow screens the sheet covers the page; get out of the way of what was opened.
        if (!window.matchMedia(DOCK_MEDIA).matches) setSheetOpen(false);
      },
      invalidate: (projectId) => {
        for (const key of [["dashboard"], ["projects"], ["inbox"], ["activity"], ["weft"]]) void qc.invalidateQueries({ queryKey: key });
        void qc.invalidateQueries({ queryKey: projectId ? ["project", projectId] : ["project"] });
      },
      setTheme,
      actor: { name: actorName, set: setActorName },
      openPalette: (search) => openCommandPalette(search ?? ""),
    }),
    [qc, world, pathname, router, setTheme, actorName, setActorName],
  );
  // Calls confirmed later should see the page as it is then, not as it was when proposed.
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  });

  const execute = useCallback(async (messageId: string, part: ToolCallPart) => {
    const tool = toolByName(part.tool);
    if (!tool) {
      patchCall(messageId, part.id, { status: "error", error: `Unknown tool ${part.tool}.` });
      return;
    }
    patchCall(messageId, part.id, { status: "running" });
    try {
      const result = await tool.run(part.input, ctxRef.current);
      patchCall(messageId, part.id, { status: "done", result });
    } catch (e) {
      patchCall(messageId, part.id, { status: "error", error: errorText(e) });
    }
  }, []);

  const propose = useCallback(
    async (messageId: string, toolName: string, input: ToolInput) => {
      const c = ctxRef.current;
      const tool = toolByName(toolName);
      if (!tool) {
        pushPart(messageId, { type: "text", text: `I tried to use “${toolName}”, which doesn't exist.` });
        return;
      }
      const details: ToolCallPart["details"] = [];
      for (const [name, spec] of Object.entries(tool.params)) {
        if (input[name] === undefined) continue;
        details.push({ label: spec.description, value: await describeValue(input[name], { ctx: c, input, spec }) });
      }
      let summary = tool.title;
      let preview: ToolCallPart["preview"];
      let blocked: string | undefined;
      try {
        summary = await tool.summary(input, c);
        preview = tool.preview ? await tool.preview(input, c) : undefined;
        blocked = tool.blocked ? await tool.blocked(input, c) : undefined;
      } catch {
        // a summary is a nicety; the call itself reports real errors
      }
      const isRead = tool.effect === "read";
      const part: ToolCallPart = { type: "call", id: newId("call"), tool: tool.name, input, summary, details, preview, blocked, status: isRead ? (blocked ? "error" : "running") : "proposed", error: isRead ? blocked : undefined };
      pushPart(messageId, part);
      if (isRead && !blocked) await execute(messageId, part);
    },
    [execute],
  );

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      const state = getAssistantState();
      if (!text || state.busy) return;
      const history = state.messages;
      const pending = state.pending;
      pushMessage({ id: newId("u"), role: "user", text, at: Date.now() });
      setPending(undefined);
      setBusy(true);
      const replyId = newId("a");
      pushMessage({ id: replyId, role: "assistant", parts: [], at: Date.now() });
      try {
        await sleep(THINK_MS);
        for await (const ev of BRAIN.respond({ text, history, pending, ctx: ctxRef.current, tools: TOOLS })) {
          if (ev.type === "text") pushPart(replyId, { type: "text", text: ev.text });
          else if (ev.type === "choices") pushPart(replyId, { type: "choices", options: ev.options });
          else if (ev.type === "ask") setPending(ev.pending);
          else await propose(replyId, ev.tool, ev.input);
        }
      } catch (e) {
        pushPart(replyId, { type: "text", text: `Something went wrong: ${errorText(e)}` });
      } finally {
        setBusy(false);
      }
    },
    [propose],
  );

  const confirm = useCallback(
    async (messageId: string, callId: string) => {
      const msg = getAssistantState().messages.find((m) => m.id === messageId);
      const part = msg?.role === "assistant" ? msg.parts.find((p): p is ToolCallPart => p.type === "call" && p.id === callId) : undefined;
      if (!part || part.status !== "proposed" || part.blocked) return;
      await execute(messageId, part);
    },
    [execute],
  );

  const cancel = useCallback((messageId: string, callId: string) => patchCall(messageId, callId, { status: "cancelled" }), []);

  return { brainLabel: BRAIN.label, ctx, send, confirm, cancel };
}
