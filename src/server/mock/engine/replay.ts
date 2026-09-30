import "server-only";
/**
 * What a resumed pass can serve from the journal instead of re-executing, like weft's replay:
 * finished steps by key (the n-th call with a key gets the n-th finished occurrence), answered
 * or still-pending human requests by key (superseded ones are skipped, so a cancelled review
 * is asked again), and counts of the unkeyed records (gates, checks, notes, logs) so a replayed
 * prefix does not journal them twice.
 *
 * A step that failed and took the run down with it (run.failed names its seq), or that a
 * cancel cut short (code "cancelled"), is not served: resuming exists to retry it. A step that
 * failed and was caught by the script is served as the same failure, so the script takes the
 * same branch again.
 */
import type { JournalRecord, ReviewEdit, SerializedStepError } from "@/lib/weft/types";
import { reduceState } from "./reduce";

export interface ServedStep {
  seq: number;
  status: "ok" | "failed";
  output?: unknown;
  error?: SerializedStepError;
}

export interface ServedHuman {
  id: string;
  status: "pending" | "answered";
  answer?: unknown;
  reviewEdit?: ReviewEdit;
}

export type CountedKind = "gates" | "checks" | "notes" | "logs";

export class ReplayIndex {
  readonly steps = new Map<string, ServedStep[]>();
  readonly humans = new Map<string, ServedHuman[]>();
  readonly patches = new Map<string, string[]>();
  readonly merges = new Map<string, number>();
  readonly counts: Record<CountedKind, number> = { gates: 0, checks: 0, notes: 0, logs: 0 };

  static fromRecords(records: readonly JournalRecord[]): ReplayIndex {
    const index = new ReplayIndex();
    const fatal = new Set<number>();
    for (const { ev } of records) {
      if (ev.type === "run.failed" && ev.error.step.seq !== undefined) fatal.add(ev.error.step.seq);
      else if (ev.type === "check") index.counts.checks++;
      else if (ev.type === "note") index.counts.notes++;
      else if (ev.type === "log") index.counts.logs++;
      else if (ev.type === "patch.captured") push(index.patches, ev.key, ev.ref);
      else if (ev.type === "patch.merged") index.merges.set(ev.key, (index.merges.get(ev.key) ?? 0) + 1);
    }
    const state = reduceState(records);
    // Seqs only grow across the mock's passes, so seq order is call order.
    for (const step of state.steps) {
      if (step.key === undefined || step.status === "running") continue;
      // A step cancel() cut short never finished: the resumed pass runs it again.
      if (step.status === "failed" && (fatal.has(step.seq) || step.error?.code === "cancelled")) continue;
      push(index.steps, step.key, {
        seq: step.seq,
        status: step.status,
        ...(step.status === "ok" ? { output: step.output } : { error: step.error }),
      });
    }
    for (const human of state.humans) {
      if (human.kind === "gate") {
        index.counts.gates++;
        continue;
      }
      if (human.key === undefined || human.status === "superseded") continue;
      push(index.humans, human.key, {
        id: human.id,
        status: human.status,
        ...(human.status === "answered" ? { answer: human.answer } : {}),
        ...(human.reviewEdit !== undefined ? { reviewEdit: human.reviewEdit } : {}),
      });
    }
    return index;
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
