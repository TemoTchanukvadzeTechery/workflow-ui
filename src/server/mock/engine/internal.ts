import "server-only";
/**
 * Engine-internal shapes shared by the runner, the script ctx and the queries. Nothing here
 * is part of the public contract (api.ts).
 */
import { TERMINAL_RUN_STATUSES, type JournalEvent, type JournalRecord, type RunStatus } from "@/lib/weft/types";
import type { MockWorkflow, StartMeta } from "./api";
import type { BlobStore } from "./blobs";
import type { BudgetLimits } from "./budget";
import type { Clock } from "./clock";
import type { Execution } from "./execution";
import type { MapWorkspaceFs } from "./fs";

export type HumanRequestedEvent = Extract<JournalEvent, { type: "human.requested" }>;

/** What the runner tracks per human request without re-folding the journal. */
export interface LiveHuman {
  request: HumanRequestedEvent;
  status: "pending" | "answered" | "superseded";
  requestedAt: number;
}

export interface RunEntry {
  runId: string;
  workflow: MockWorkflow;
  meta: StartMeta;
  records: JournalRecord[];
  /** Mirrors the fold's status, updated on every append. */
  status: RunStatus;
  /** Cumulative spend, i.e. the last budget.sampled. */
  spend: { tokens: number; usd: number };
  limits: BudgetLimits | null;
  input: unknown;
  humans: Map<string, LiveHuman>;
  /** Highest h<n> issued, so ids keep counting across resumes. */
  humanCount: number;
  /** Highest seq journaled (steps and humans); a resumed pass continues after it. */
  maxSeq: number;
  /** Phase names already journaled. */
  phases: Set<string>;
  /** requestId -> "Acting as" name of whoever answered it. */
  actors: Map<string, string>;
  /** The live pass of the script, if one is running. */
  exec?: Execution;
  /** Insertion order, the tiebreak for runs created in the same millisecond. */
  order: number;
}

/** The runner surface the script ctx needs. */
export interface CtxHost {
  readonly clock: Clock;
  readonly blobs: BlobStore;
  readonly fs: MapWorkspaceFs;
  append(run: RunEntry, ev: JournalEvent, actor?: string): JournalRecord;
  setStatus(run: RunEntry, status: RunStatus): void;
  /** A non-gate request is now pending: wake waitForHuman callers, stop fast-forwarding. */
  humanOpened(run: RunEntry, id: string): void;
}

export const TERMINAL: ReadonlySet<RunStatus> = new Set(TERMINAL_RUN_STATUSES);

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL.has(status);
}

/** JSON round-trip: what the journal can hold (drops undefined and functions, copies deeply). */
export function jsonClone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Keep the tracked fields of a run in step with each appended record. */
export function track(run: RunEntry, rec: JournalRecord): void {
  const ev = rec.ev;
  switch (ev.type) {
    case "run.status":
      run.status = ev.status;
      break;
    case "run.completed":
      run.status = "complete";
      break;
    case "run.failed":
      run.status = "failed";
      break;
    case "run.cancelled":
      run.status = "cancelled";
      break;
    case "phase":
      run.phases.add(ev.name);
      break;
    case "step.scheduled":
      run.maxSeq = Math.max(run.maxSeq, ev.seq);
      break;
    case "budget.sampled":
      run.spend = { tokens: ev.tokens, usd: ev.usd };
      break;
    case "human.requested": {
      run.maxSeq = Math.max(run.maxSeq, ev.seq);
      const n = Number.parseInt(ev.id.replace(/^h/, ""), 10);
      if (Number.isFinite(n)) run.humanCount = Math.max(run.humanCount, n);
      run.humans.set(ev.id, { request: ev, status: "pending", requestedAt: rec.at });
      break;
    }
    case "human.answered": {
      const h = run.humans.get(ev.id);
      if (h && h.status === "pending") h.status = "answered";
      break;
    }
    case "human.superseded": {
      const h = run.humans.get(ev.id);
      if (h) h.status = "superseded";
      break;
    }
    default:
      break;
  }
}
