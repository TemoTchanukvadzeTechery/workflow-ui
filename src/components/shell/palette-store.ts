"use client";

import { useSyncExternalStore } from "react";

/**
 * Open state and search text of the one command palette the shell mounts. A module store (not a
 * context) so anything can open it, prefilled, without a provider: the nav's search button, ⌘K,
 * and the Home prompt band.
 */
interface PaletteState {
  open: boolean;
  search: string;
}

const CLOSED: PaletteState = { open: false, search: "" };
let state: PaletteState = CLOSED;
const listeners = new Set<() => void>();

function set(next: PaletteState) {
  state = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Open the command palette, optionally with its search box prefilled. */
export function openCommandPalette(search = ""): void {
  set({ open: true, search });
}

export function closeCommandPalette(): void {
  if (state.open) set({ ...state, open: false });
}

/** ⌘K: open with an empty search, or close. */
export function toggleCommandPalette(): void {
  set(state.open ? { ...state, open: false } : { open: true, search: "" });
}

export function setCommandPaletteSearch(search: string): void {
  set({ ...state, search });
}

export function useCommandPaletteState(): PaletteState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => CLOSED,
  );
}
