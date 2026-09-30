import "server-only";
/**
 * In-process pub/sub of LiveEvents for /api/events. The engine journals many records per second
 * while runs tick, so identical run/project/inbox events are throttled: the first one goes out at
 * once, repeats inside the window collapse into one trailing delivery. notify/settings/reset are
 * never coalesced.
 */
import type { LiveEvent } from "@/lib/delivery/types";

export interface Bus {
  publish(event: LiveEvent): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: (event: LiveEvent) => void): () => void;
  /** Number of live subscribers (SSE connections). */
  size(): number;
}

const COALESCED: ReadonlySet<LiveEvent["type"]> = new Set(["run", "project", "inbox"]);

export function createBus(opts: { windowMs?: number } = {}): Bus {
  const windowMs = opts.windowMs ?? 100;
  const listeners = new Set<(event: LiveEvent) => void>();
  const windows = new Map<string, { dirty: boolean }>();

  const deliver = (event: LiveEvent) => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (err) {
        console.error("[bus] listener failed", err);
      }
    }
  };

  const openWindow = (key: string, event: LiveEvent) => {
    const w = { dirty: false };
    windows.set(key, w);
    const timer = setTimeout(() => {
      windows.delete(key);
      if (w.dirty) {
        deliver(event);
        openWindow(key, event);
      }
    }, windowMs);
    // Never keep a process (or a tsx smoke script) alive just to flush a UI hint.
    (timer as { unref?: () => void }).unref?.();
  };

  return {
    publish(event) {
      if (!COALESCED.has(event.type)) return deliver(event);
      const key = JSON.stringify(event);
      const w = windows.get(key);
      if (w) {
        w.dirty = true;
        return;
      }
      deliver(event);
      openWindow(key, event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    size: () => listeners.size,
  };
}
