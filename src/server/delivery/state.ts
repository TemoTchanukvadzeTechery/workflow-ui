import "server-only";
/**
 * Internal shapes of the in-memory delivery store and the per-request weft snapshot the derived
 * views are computed from. Nothing here is sent over the wire as-is except StoredDoc, whose extra
 * fields are optional additions to DocumentArtifact.
 */
import type {
  ChangeReview,
  Decision,
  DeliveryTask,
  DocumentArtifact,
  Epic,
  Evidence,
  Project,
  StageId,
} from "@/lib/delivery/types";
import type { PendingEntry, RunRow } from "@/lib/weft/types";
import type { OpenQuestion, SystemChange } from "./parse";

/** DocumentArtifact plus parse results the derived views need (optional additions). */
export interface StoredDoc extends DocumentArtifact {
  openQuestions?: OpenQuestion[];
  /** AAD only: the High-Level Architecture system change table. */
  systems?: SystemChange[];
  /** BRD only: Implementation Plan checklist items. */
  implementationPlan?: string[];
}

export interface ProjectData {
  project: Project;
  documents: StoredDoc[];
  epics: Epic[];
  tasks: DeliveryTask[];
  evidence: Evidence[];
  changeReviews: ChangeReview[];
  /** brRef → waiver decision. */
  waivers: Record<string, Decision>;
  /** Id counters per kind ("epic", "decision", "note", "evidence", "change", "source", doc kinds). */
  counters: Record<string, number>;
  /** Task ids a person asked to start; the scheduler starts them when dependencies and slots allow. */
  queue: string[];
}

/** Which project/stage/task a weft run belongs to (weft itself has no project concept). */
export interface RunOwner {
  projectId: string;
  stage: StageId;
  workflow: string;
  taskId?: string;
}

/** Cached from human.requested events so pending entries can be joined without refetching runs. */
export interface RequestInfo {
  key?: string;
  phase?: string;
  kind: string;
  question: string;
  detail?: string;
}

/** A store-level FYI notice not derived from runs (e.g. a seeding error). */
export interface SystemNotice {
  id: string;
  projectId: string;
  stage: StageId;
  text: string;
  level: "info" | "warning" | "error";
  at: number;
}

/** Weft state read once per request; derive/inbox/dashboard are pure functions of it. */
export interface Snapshot {
  now: number;
  runs: Map<string, RunRow>;
  pending: PendingEntry[];
  /** `${runId}:${requestId}` → request info. */
  requests: Map<string, RequestInfo>;
  owners: Map<string, RunOwner>;
  /** runId → error message of a failed run. */
  failures: Map<string, string>;
  /** runId → current weft phase. */
  phases: Map<string, string>;
  /** runId → run input (dev-task origin, attempt…). */
  inputs: Map<string, unknown>;
  notices: SystemNotice[];
}

export const reqKey = (runId: string, requestId: string) => `${runId}:${requestId}`;
