"use client";

import { useEffect, useRef } from "react";

export interface HotkeyOptions {
  /** Require Cmd (macOS) or Ctrl (elsewhere). */
  mod?: boolean;
  /** Fire even while an input, textarea, select or contenteditable has focus. Default: only with `mod`. */
  inInputs?: boolean;
  enabled?: boolean;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Global keyboard shortcut. `key` is compared case-insensitively against KeyboardEvent.key, so
 * useHotkey("k", open, { mod: true }) is Cmd/Ctrl+K and useHotkey("j", next) is plain J (ignored
 * while typing).
 */
export function useHotkey(key: string | string[], handler: (e: KeyboardEvent) => void, opts: HotkeyOptions = {}): void {
  const { mod = false, inInputs = mod, enabled = true } = opts;
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  const keys = (Array.isArray(key) ? key : [key]).map((k) => k.toLowerCase());
  const keysSig = keys.join("|");

  useEffect(() => {
    if (!enabled) return;
    const wanted = keysSig.split("|");
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (!wanted.includes(e.key.toLowerCase())) return;
      const hasMod = e.metaKey || e.ctrlKey;
      if (mod !== hasMod) return;
      if (!mod && (e.altKey || e.metaKey || e.ctrlKey)) return;
      if (!inInputs && isTypingTarget(e.target)) return;
      handlerRef.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keysSig, mod, inInputs, enabled]);
}
