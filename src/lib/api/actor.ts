"use client";

/**
 * "Acting as": there are no roles yet, so anyone can approve anything, but every decision records
 * a name. Stored per browser; sent as the `x-actor` header on every API call.
 */
import { useSyncExternalStore } from "react";

const KEY = "workflow-ui:actor";
export const DEFAULT_ACTOR = "Demo user";

const listeners = new Set<() => void>();

export function getActorName(): string {
  if (typeof window === "undefined") return DEFAULT_ACTOR;
  try {
    return window.localStorage.getItem(KEY)?.trim() || DEFAULT_ACTOR;
  } catch {
    return DEFAULT_ACTOR;
  }
}

export function setActorName(name: string): void {
  try {
    window.localStorage.setItem(KEY, name.trim() || DEFAULT_ACTOR);
  } catch {
    // storage unavailable: keep the default
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useActorName(): [string, (name: string) => void] {
  const name = useSyncExternalStore(subscribe, getActorName, () => DEFAULT_ACTOR);
  return [name, setActorName];
}
