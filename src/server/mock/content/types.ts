import "server-only";
/**
 * Types shared by the po-brd / architect-aad mock scripts and the content packs that stand in
 * for the agents: the discovery planner, the drafting agent, and the memory proposer.
 */
import type { AadReport, DraftReport } from "@/lib/delivery/types";
import type { ChangeKind } from "@/lib/weft/workflows";

export type DocType = "BRD" | "AAD";

/** A dependency as the discovery planner lists it (po-brd lib/discovery.ts Dependency). */
export interface Dependency {
  ref: string;
  kind: "jira" | "confluence";
  title: string;
  relation: string;
  why: string;
}

/** A dependency the human confirmed, with its fetched content, cited as R<n>. */
export interface Evidence extends Dependency {
  id: string;
  text: string;
}

/** One source entry as the drafting agent sees it: N1.. (PO notes) or A1.. (architect notes). */
export interface NoteSource {
  id: string;
  /** Repository path, or "inline" for typed text. */
  path: string;
  content: string;
  type: string;
  /** The original entry (a path or the inline text). */
  entry: string;
}

export interface AtlQuery {
  purpose: string;
  args: string[];
}

export interface DiscoveryPlan {
  queries: AtlQuery[];
  relevant: Dependency[];
  done: boolean;
}

export interface Observation {
  key: string;
  args: string[];
  ok: boolean;
  text: string;
}

export interface PlannerState {
  docType: DocType;
  /** Human review pass, 1..3. */
  pass: number;
  /** Global planner round: the N in discover:N. */
  round: number;
  /** Round within this pass, 1..discoveryRounds+1. */
  roundInPass: number;
  final: boolean;
  relevant: readonly Dependency[];
  seeds: readonly Dependency[];
  /** Refs the human removed at a dependency review. */
  removed: readonly string[];
  guidance: string;
  observations: readonly Observation[];
}

export interface Planner {
  plan(state: PlannerState): DiscoveryPlan;
}

export interface MemoryView {
  path: string;
  content: string;
  stale: string[];
}

export interface DraftContext {
  docType: DocType;
  runId: string;
  projectId?: string;
  /** The delivery project's name, as its people wrote it; the draft's title when there is no better one. */
  projectName?: string;
  round: number;
  out: string;
  request: string;
  /** Loaded note entries, in order (N1.. or A1..). */
  notes: NoteSource[];
  /** architect-aad only: the accepted BRD, cited as B1. */
  brd?: { path: string; content: string };
  evidence: Evidence[];
  memory: MemoryView;
  now: number;
}

export interface ReviseContext extends DraftContext {
  /** The file as it is now, including the human's edits. */
  current: string;
  /** What the agent wrote last round; differs from `current` when the human edited. */
  lastAgent: string;
  feedback: string;
  /** Notes added at the last review (already included in `notes`). */
  newNotes: NoteSource[];
  previousReport: DraftReport | AadReport;
}

export interface DocResult<R> {
  content: string;
  report: R;
}

export interface MemoryChange {
  kind: ChangeKind;
  summary: string;
}

/** What the memory agent proposes (po-brd lib/memory.ts MemoryProposal). */
export interface MemoryProposal {
  major: boolean;
  changes: MemoryChange[];
  affectsOtherDocuments: string[];
  proposedMemory: string;
}

export interface ProposeMemoryOptions {
  docType: DocType;
  path: string;
  content: string;
  sha256: string;
  runId: string;
  /** The memory text the proposal is based on. */
  base: string;
  projectId?: string;
}
