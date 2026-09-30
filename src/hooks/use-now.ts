"use client";

/**
 * A shared clock: every component asking for the same period shares one interval, so a page of
 * 200 RelativeTime cells does not start 200 timers. Returns epoch ms, refreshed every `periodMs`.
 */
import { useSyncExternalStore } from "react";

interface Ticker {
  now: number;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
}

const tickers = new Map<number, Ticker>();
// Fixed per module load so hydration sees one stable server snapshot.
const bootNow = Date.now();

function ticker(periodMs: number): Ticker {
  let t = tickers.get(periodMs);
  if (!t) {
    t = { now: Date.now(), listeners: new Set(), timer: null };
    tickers.set(periodMs, t);
  }
  return t;
}

function subscribe(periodMs: number, listener: () => void): () => void {
  const t = ticker(periodMs);
  t.listeners.add(listener);
  if (!t.timer) {
    // The clock may have been idle with no subscribers; catch up before the first tick.
    const fresh = Date.now();
    if (fresh - t.now >= 1_000) {
      t.now = fresh;
      queueMicrotask(() => t.listeners.forEach((l) => l()));
    }
    t.timer = setInterval(() => {
      t.now = Date.now();
      t.listeners.forEach((l) => l());
    }, periodMs);
  }
  return () => {
    t.listeners.delete(listener);
    if (t.listeners.size === 0 && t.timer) {
      clearInterval(t.timer);
      t.timer = null;
    }
  };
}

export function useNow(periodMs = 30_000): number {
  return useSyncExternalStore(
    (l) => subscribe(periodMs, l),
    () => ticker(periodMs).now,
    () => bootNow,
  );
}
