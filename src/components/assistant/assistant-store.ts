"use client";

import { useSyncExternalStore } from "react";
import type { AssistantPart, ChatMessage, PendingAsk, ToolCallPart } from "@/lib/assistant/types";
import { ASSISTANT_OPEN_KEY } from "./boot";

/**
 * The assistant's state, shared by the docked panel, the narrow-screen sheet and the nav
 * button: a module store like palette-store.ts, so anything can open it.
 *
 * - `docked`: the panel beside the page on screens from 64rem (1024px). Open on a first visit,
 *   then remembered per browser. The boot script in layout.tsx copies it to
 *   `<html data-assistant="open">` before first paint; globals.css shows the dock and shifts the
 *   page's breakpoints from that attribute, so a reload doesn't shift the page.
 * - `sheet`: the overlay on narrower screens. Not remembered: a reload never opens a sheet.
 * - `messages`, `pending`: the conversation, kept per browser (the last MAX_MESSAGES).
 */
export interface AssistantState {
  docked: boolean;
  sheet: boolean;
  messages: ChatMessage[];
  pending?: PendingAsk;
  busy: boolean;
  /** Bumped to ask the composer to take focus. */
  focusTick: number;
}

const CHAT_KEY = "wefty:assistant:chat";
const MAX_MESSAGES = 60;
/** Must match the dock media query in globals.css. */
export const DOCK_MEDIA = "(min-width: 64rem)";
/** The docked panel's width plus its outer gap; the toaster moves left by this much. */
export const DOCK_INSET_PX = 400;

const SERVER: AssistantState = { docked: false, sheet: false, messages: [], busy: false, focusTick: 0 };

function load(): AssistantState {
  if (typeof window === "undefined") return SERVER;
  let docked = true;
  let messages: ChatMessage[] = [];
  let pending: PendingAsk | undefined;
  try {
    // Open unless the person closed it last time.
    docked = window.localStorage.getItem(ASSISTANT_OPEN_KEY) !== "0";
    const raw = window.localStorage.getItem(CHAT_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { messages?: ChatMessage[]; pending?: PendingAsk };
      messages = (saved.messages ?? []).map(settleInterrupted);
      pending = saved.pending;
    }
  } catch {
    // storage unavailable or corrupt: start empty
  }
  return { docked, sheet: false, messages, pending, busy: false, focusTick: 0 };
}

/** A call that was running when the page went away did not report back. */
function settleInterrupted(m: ChatMessage): ChatMessage {
  if (m.role !== "assistant" || !m.parts.some((p) => p.type === "call" && p.status === "running")) return m;
  return { ...m, parts: m.parts.map((p) => (p.type === "call" && p.status === "running" ? { ...p, status: "error", error: "Interrupted by a page reload; check the page to see whether it went through." } : p)) };
}

let state: AssistantState | null = null;
const listeners = new Set<() => void>();
const current = () => (state ??= load());

function save(s: AssistantState) {
  try {
    window.localStorage.setItem(ASSISTANT_OPEN_KEY, s.docked ? "1" : "0");
    window.localStorage.setItem(CHAT_KEY, JSON.stringify({ messages: s.messages.slice(-MAX_MESSAGES), pending: s.pending }));
  } catch {
    // quota or storage blocked: keep the session in memory only
  }
}

function set(patch: Partial<AssistantState>) {
  const next = { ...current(), ...patch };
  state = next;
  if (typeof document !== "undefined") document.documentElement.dataset.assistant = next.docked ? "open" : "closed";
  save(next);
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAssistantState(): AssistantState {
  return useSyncExternalStore(subscribe, current, () => SERVER);
}

const isWide = () => typeof window !== "undefined" && window.matchMedia(DOCK_MEDIA).matches;

/** Open the panel (docked on wide screens, a sheet otherwise) and focus its composer. */
export function openAssistant(): void {
  const s = current();
  set(isWide() ? { docked: true, focusTick: s.focusTick + 1 } : { sheet: true, focusTick: s.focusTick + 1 });
}

export function closeAssistant(): void {
  set({ docked: false, sheet: false });
}

/** Whether the panel is showing at the current width. */
export function isAssistantShowing(s: AssistantState = current()): boolean {
  return isWide() ? s.docked : s.sheet;
}

export function toggleAssistant(): void {
  if (isAssistantShowing()) closeAssistant();
  else openAssistant();
}

export function setSheetOpen(open: boolean): void {
  set({ sheet: open });
}

// ---------------------------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------------------------

let seq = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function pushMessage(m: ChatMessage): void {
  set({ messages: [...current().messages, m].slice(-MAX_MESSAGES) });
}

export function pushPart(messageId: string, part: AssistantPart): void {
  set({ messages: current().messages.map((m) => (m.id === messageId && m.role === "assistant" ? { ...m, parts: [...m.parts, part] } : m)) });
}

export function patchCall(messageId: string, callId: string, patch: Partial<ToolCallPart>): void {
  set({
    messages: current().messages.map((m) =>
      m.id === messageId && m.role === "assistant" ? { ...m, parts: m.parts.map((p) => (p.type === "call" && p.id === callId ? { ...p, ...patch } : p)) } : m,
    ),
  });
}

export function setPending(pending: PendingAsk | undefined): void {
  set({ pending });
}

export function setBusy(busy: boolean): void {
  set({ busy });
}

export function clearConversation(): void {
  set({ messages: [], pending: undefined, busy: false });
}

export const getAssistantState = current;

