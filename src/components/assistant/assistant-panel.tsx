"use client";

import { ArrowUp, SquarePen, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CircleIconButton } from "@/components/common/circle-icon-button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { starterChoices } from "@/lib/assistant/mock-brain";
import type { Choice, ChatMessage } from "@/lib/assistant/types";
import { cn } from "@/lib/utils";
import { useIsMac } from "@/components/shell/use-is-mac";
import { clearConversation, useAssistantState } from "./assistant-store";
import { AssistantMark } from "./assistant-mark";
import { Choices, MessageText, ToolCallCard } from "./parts";
import { useAssistant, type AssistantController } from "./use-assistant";

/** Composer height limit before it scrolls. */
const COMPOSER_MAX_PX = 140;

function Thinking() {
  return (
    <span role="status" aria-label="Thinking" className="inline-flex h-5 items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60 motion-reduce:animate-none" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </span>
  );
}

function Message({ m, last, busy, ctl, onNavigate }: { m: ChatMessage; last: boolean; busy: boolean; ctl: AssistantController; onNavigate?: () => void }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-[18px] rounded-br-[6px] bg-well px-3.5 py-2 text-[14px] leading-[21px] break-words whitespace-pre-wrap text-heading">{m.text}</p>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <AssistantMark size={26} className="mt-px" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {m.parts.length === 0 && last && busy && <Thinking />}
        {m.parts.map((p, i) => {
          if (p.type === "text") return <MessageText key={i} text={p.text} />;
          // Only the latest reply's chips stay clickable; older ones are history.
          if (p.type === "choices") return <Choices key={i} options={p.options} onPick={(reply) => void ctl.send(reply)} disabled={!last || busy} />;
          return <ToolCallCard key={p.id} part={p} onConfirm={() => void ctl.confirm(m.id, p.id)} onCancel={() => ctl.cancel(m.id, p.id)} onNavigate={onNavigate} />;
        })}
      </div>
    </div>
  );
}

function Welcome({ ctl }: { ctl: AssistantController }) {
  const [starters, setStarters] = useState<Choice[]>([]);
  const ctx = ctl.ctx;
  useEffect(() => {
    let live = true;
    void starterChoices(ctx).then((c) => live && setStarters(c));
    return () => {
      live = false;
    };
  }, [ctx]);
  return (
    <div className="flex flex-1 flex-col justify-center gap-5 px-1 py-6">
      <AssistantMark size={52} />
      <div className="flex flex-col gap-2">
        <h2 className="text-[26px] leading-[1.15] font-normal tracking-[-0.03em] text-heading">How can I help today?</h2>
        <p className="text-[14px] leading-[21px] text-muted-foreground">
          Ask about your projects, or tell me what to do: start runs, answer requests, approve gates, search memory. I can do anything the app can, and changes wait for your Confirm.
        </p>
      </div>
      {starters.length > 0 && <Choices options={starters} onPick={(reply) => void ctl.send(reply)} />}
    </div>
  );
}

function Composer({ ctl, busy, focusTick }: { ctl: AssistantController; busy: boolean; focusTick: number }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const isMac = useIsMac();

  useEffect(() => {
    if (focusTick > 0) ref.current?.focus();
  }, [focusTick]);

  // Grow with the text up to COMPOSER_MAX_PX.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_PX)}px`;
  }, [text]);

  const submit = () => {
    if (!text.trim() || busy) return;
    void ctl.send(text);
    setText("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      className="prompt-band rounded-[22px] p-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="prompt-field flex items-end gap-2 py-1.5 pr-1.5 pl-3">
        <label htmlFor={inputId} className="sr-only">
          Message the assistant
        </label>
        <textarea
          id={inputId}
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask, or tell me what to do…"
          className="max-h-[140px] min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[14px] leading-5 text-heading outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!text.trim() || busy}
          className="ink-surface inline-flex size-8 shrink-0 items-center justify-center rounded-full text-ink-foreground outline-none transition-opacity focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-35"
        >
          <ArrowUp aria-hidden className="size-4" strokeWidth={2.25} />
        </button>
      </div>
      <p className="px-2 pt-1.5 text-[11.5px] text-muted-foreground">
        Enter to send · Shift+Enter for a new line · <Kbd className="h-4 px-1 text-[10.5px]">{isMac ? "⌘J" : "Ctrl J"}</Kbd> to show or hide
      </p>
    </form>
  );
}

/**
 * The assistant's panel: a header, the conversation (or "How can I help today?") and the
 * composer. Rendered by the dock on wide screens and inside a sheet on narrow ones.
 */
export function AssistantPanel({ onClose, onNavigate, className }: { onClose: () => void; onNavigate?: () => void; className?: string }) {
  const ctl = useAssistant();
  const { messages, busy, focusTick } = useAssistantState();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Follow the conversation as it grows.
  const lastKey = messages.length ? `${messages.at(-1)?.id}:${JSON.stringify(messages.at(-1)).length}` : "";
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lastKey]);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <header className="flex h-16 shrink-0 items-center gap-3 px-4">
        <AssistantMark size={32} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] leading-5 font-medium tracking-[-0.01em] text-heading">Assistant</h2>
          <p className="truncate text-[12px] leading-4 text-muted-foreground">{ctl.brainLabel} · acting as {ctl.ctx.actor.name}</p>
        </div>
        {messages.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <CircleIconButton icon={SquarePen} label="New conversation" size="md" onClick={clearConversation} disabled={busy} />
            </TooltipTrigger>
            <TooltipContent side="bottom">New conversation</TooltipContent>
          </Tooltip>
        )}
        <CircleIconButton icon={X} label="Close assistant" size="md" onClick={onClose} />
      </header>
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-4" aria-live="polite" aria-busy={busy}>
        {messages.length === 0 ? (
          <Welcome ctl={ctl} />
        ) : (
          <div className="flex flex-col gap-5 pt-2">
            {messages.map((m, i) => (
              <Message key={m.id} m={m} last={i === messages.length - 1} busy={busy} ctl={ctl} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 px-3 pb-3">
        <Composer ctl={ctl} busy={busy} focusTick={focusTick} />
      </div>
    </div>
  );
}
