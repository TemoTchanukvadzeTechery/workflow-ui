import "server-only";
/**
 * Time for the mock engine. Every script sleep goes through here so the demo speed setting,
 * the "skip to next human step" button, cancellation and seeding all act in one place.
 *
 * - Speed scales a step's base ("fast") duration: instant x0, fast x1, realistic x5. A speed
 *   change applies to sleeps already running within half a second.
 * - Sleeps are tagged with their runId: cancel(tag) rejects them, fastForward(tag) resolves
 *   them, and skip(tag) makes later sleeps of that run resolve at once until cleared.
 * - withVirtualClock(startAt, fn): while fn runs, sleeps resolve on the next macrotask and
 *   now() advances by each sleep's realistic duration, so seeded runs get believable
 *   timestamps without waiting. Not re-entrant. Afterwards now() is Date.now() again.
 */
import type { DemoSpeed } from "@/lib/delivery/types";

const MULTIPLIER: Record<DemoSpeed, number> = { instant: 0, fast: 1, realistic: 5 };
const REALISTIC = MULTIPLIER.realistic;
/** Longest a running sleep goes without re-reading the speed setting. */
const RECHECK_MS = 500;

interface Sleeper {
  tag: string;
  finish(): void;
  fail(err: Error): void;
}

export function defer(fn: () => void): void {
  if (typeof setImmediate === "function") setImmediate(fn);
  else setTimeout(fn, 0);
}

export class Clock {
  private readonly sleepers = new Set<Sleeper>();
  private readonly skipping = new Set<string>();
  private virtual = false;
  private virtualNow = 0;
  private ticks = 0;

  constructor(private readonly speed: () => DemoSpeed) {}

  get isVirtual(): boolean {
    return this.virtual;
  }

  now(): number {
    return this.virtual ? this.virtualNow : Date.now();
  }

  /**
   * Timestamp for a journal record. Under the virtual clock consecutive records get a few ms
   * apart (a real journal shows 10-50 ms between appends) instead of identical stamps.
   */
  stamp(): number {
    if (!this.virtual) return Date.now();
    this.virtualNow += 4 + ((this.ticks++ * 7) % 23);
    return this.virtualNow;
  }

  private multiplier(): number {
    return MULTIPLIER[this.speed()] ?? 1;
  }

  sleep(baseMs: number, tag: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const base = Math.max(0, baseMs);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let done = false;
      // Progress is counted in base ms and re-read at least every RECHECK_MS, so switching the
      // speed in Settings also applies to the rest of a step that is already running.
      let remaining = base;
      let mark = Date.now();
      const settle = (): boolean => {
        if (done) return false;
        done = true;
        if (timer) clearTimeout(timer);
        this.sleepers.delete(sleeper);
        return true;
      };
      const sleeper: Sleeper = {
        tag,
        finish: () => {
          if (!settle()) return;
          if (this.virtual) this.virtualNow += base * REALISTIC;
          resolve();
        },
        fail: (err) => {
          if (settle()) reject(err);
        },
      };
      const schedule = (mult: number) => {
        timer = setTimeout(tick, Math.min(remaining * mult, RECHECK_MS));
      };
      const tick = () => {
        if (done) return;
        const mult = this.multiplier();
        const now = Date.now();
        remaining = mult > 0 ? remaining - (now - mark) / mult : 0;
        mark = now;
        // Timers can fire a hair early; half a millisecond left is done.
        if (remaining <= 0.5 || this.skipping.has(tag)) sleeper.finish();
        else schedule(mult);
      };
      this.sleepers.add(sleeper);
      const mult = this.multiplier();
      if (this.virtual || base <= 0 || mult <= 0 || this.skipping.has(tag)) defer(sleeper.finish);
      else schedule(mult);
    });
  }

  /** Resolve pending sleeps now (all, or one run's). */
  fastForward(tag?: string): void {
    for (const s of [...this.sleepers]) if (tag === undefined || s.tag === tag) s.finish();
  }

  /** Sticky fast-forward for one run: later sleeps resolve at once until turned off. */
  skip(tag: string, on: boolean): void {
    if (on) this.skipping.add(tag);
    else this.skipping.delete(tag);
  }

  cancel(tag: string, err: Error): void {
    for (const s of [...this.sleepers]) if (s.tag === tag) s.fail(err);
    this.skipping.delete(tag);
  }

  cancelAll(err: Error): void {
    for (const s of [...this.sleepers]) s.fail(err);
    this.skipping.clear();
  }

  async withVirtualClock<T>(startAt: number, fn: () => Promise<T>): Promise<T> {
    if (this.virtual) throw new Error("withVirtualClock: nested calls are not supported");
    this.virtual = true;
    this.virtualNow = startAt;
    try {
      return await fn();
    } finally {
      this.virtual = false;
    }
  }
}
