import "server-only";
/**
 * One pass of a run's script: the first start, or a resume. It owns the seq counter, the
 * current phase, the pending human waits and the replay cursors. Cancel (or reset) fences it:
 * every pending wait rejects with a CancelledError and every later ctx call throws one, so a
 * script that swallows the first rejection still cannot journal anything more.
 */
import type { RunEntry } from "./internal";
import type { CountedKind, ReplayIndex, ServedHuman, ServedStep } from "./replay";

export interface Answered {
  answer: unknown;
  edited?: { path: string; content: string };
}

interface Waiter {
  resolve(answer: Answered): void;
  reject(err: Error): void;
}

export class Execution {
  fenced = false;
  fenceError?: Error;
  /** False while a resumed pass is still inside the journaled prefix. */
  live: boolean;
  seq: number;
  phase?: string;
  /** Seq of the most recent step this pass scheduled (the default for patch.captured). */
  lastStepSeq?: number;
  readonly waiters = new Map<string, Waiter>();
  private readonly cursors = new Map<string, number>();
  private readonly counted: Record<CountedKind, number> = { gates: 0, checks: 0, notes: 0, logs: 0 };

  constructor(
    readonly run: RunEntry,
    readonly replay?: ReplayIndex,
  ) {
    this.seq = run.maxSeq;
    this.live = replay === undefined;
  }

  get resuming(): boolean {
    return this.replay !== undefined;
  }

  private nextOf<T>(bucket: string, key: string, list: T[] | undefined): T | undefined {
    const cursor = `${bucket}\u0000${key}`;
    const n = this.cursors.get(cursor) ?? 0;
    this.cursors.set(cursor, n + 1);
    return list?.[n];
  }

  serveStep(key: string): ServedStep | undefined {
    return this.replay ? this.nextOf("step", key, this.replay.steps.get(key)) : undefined;
  }

  serveHuman(key: string): ServedHuman | undefined {
    return this.replay ? this.nextOf("human", key, this.replay.humans.get(key)) : undefined;
  }

  servePatch(key: string): string | undefined {
    return this.replay ? this.nextOf("patch", key, this.replay.patches.get(key)) : undefined;
  }

  serveMerge(key: string): boolean {
    if (!this.replay) return false;
    const cursor = `merge\u0000${key}`;
    const n = this.cursors.get(cursor) ?? 0;
    this.cursors.set(cursor, n + 1);
    return n < (this.replay.merges.get(key) ?? 0);
  }

  /** Unkeyed records are served by count, and only until the pass first goes live. */
  serveCounted(kind: CountedKind): boolean {
    if (!this.replay || this.live) return false;
    const used = this.counted[kind]++;
    if (used < this.replay.counts[kind]) return true;
    this.live = true;
    return false;
  }

  wait(id: string): Promise<Answered> {
    return new Promise<Answered>((resolve, reject) => {
      if (this.fenced) {
        reject(this.fenceError ?? new Error("execution fenced"));
        return;
      }
      this.waiters.set(id, { resolve, reject });
    });
  }

  deliver(id: string, answer: Answered): boolean {
    const waiter = this.waiters.get(id);
    if (!waiter) return false;
    this.waiters.delete(id);
    waiter.resolve(answer);
    return true;
  }

  fence(err: Error): void {
    if (this.fenced) return;
    this.fenced = true;
    this.fenceError = err;
    const waiters = [...this.waiters.values()];
    this.waiters.clear();
    for (const w of waiters) w.reject(err);
  }
}
