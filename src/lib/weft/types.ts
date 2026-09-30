/**
 * Weft daemon wire shapes, copied by name from weft/packages/core/src/{events,projections}.ts
 * and weft/apps/ui/src/api/types.ts. The mock daemon (src/server/mock) produces exactly these,
 * and the real daemon serves them at http://127.0.0.1:4781/api/…, so the UI never knows which
 * one it is talking to. Keep field names identical to weft; do not add UI-only fields here.
 */

export type RunStatus =
  | "planning"
  | "executing"
  | "waiting_for_human"
  | "waiting_for_signal"
  | "integrating"
  | "verifying"
  | "complete"
  | "failed"
  | "cancelled";

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ["complete", "failed", "cancelled"];

export type StepKind =
  | "agent"
  | "human"
  | "workflow"
  | "git"
  | "exec"
  | "bash"
  | "fetch"
  | "fs"
  | "env"
  | "check"
  | "sleep"
  | "signal"
  | "ui"
  | "sideeffect";

export type StepStatus = "running" | "ok" | "failed";
/** weft has no "choose" kind: choices are enums in the answer schema. */
export type HumanKind = "gate" | "ask" | "approve" | "review" | "confirm";
export type HumanStatus = "pending" | "answered" | "superseded";
export type AnsweredBy = "human" | "policy" | "timeout";
export type Risk = "low" | "medium" | "high" | "irreversible";
export type ApprovalMode = "auto" | "ask";
export type JsonSchema = Record<string, unknown>;

/** Content-addressed blob: `$blob` is a 64-char sha256 hex; `preview` is the first 200 chars. */
export type BlobRef = { $blob: string; size: number; preview?: string };
export type Usage = { input: number; output: number; cacheRead?: number; usd?: number; samples?: number };

export type StepErrorCode =
  | "internal"
  | "human_denied"
  | "gate_denied"
  | "budget_exceeded"
  | "invalid_answer"
  | "conflict"
  | "check_failed"
  | (string & {});

export interface SerializedStepError {
  name: "StepError";
  code: StepErrorCode;
  message: string;
  step: { seq?: number; key?: string; kind?: string; label?: string; runId?: string };
  attempts?: number;
  detail?: unknown;
}

export type ReviewSubject =
  | { kind: "artifact"; ref: BlobRef; mediaType?: string; label?: string }
  | { kind: "file"; path: string; mode: "view" | "edit"; ref: BlobRef; sha256: string };

export type ReviewAttachment = { kind: "artifact"; ref: BlobRef; mediaType?: string; label?: string };
export type ReviewEdit = { path: string; beforeSha256: string; afterSha256: string; ref: BlobRef };

export type CheckEvidence =
  | { kind: "text"; text: string }
  | { kind: "file"; path: string; line?: number; message?: string }
  | { kind: "metric"; name: string; actual: number; expected?: number; unit?: string }
  | { kind: "command"; exitCode: number; output?: string }
  | { kind: "artifact"; ref: string; label?: string };

/** A workflow-provided React view for a step or human request. Neither real workflow uses it yet. */
export interface UiPresentation {
  id: string;
  asset: { id: string; revision: string; bundleRef: { $blob: string; size: number; preview?: string }; protocol: 1 };
  props: { inline: unknown; hash: string } | { ref: BlobRef; hash: string };
  mode: "display" | "input";
  slot?: string;
}

// ---------------------------------------------------------------------------------------------
// Projections (the folded journal)
// ---------------------------------------------------------------------------------------------

export interface StepState {
  seq: number;
  kind: StepKind;
  key?: string;
  label?: string;
  phase?: string;
  parentSeq?: number;
  /** Real runs: { provider: "claude", model: "claude-opus-5", effort: "medium" }. */
  route?: { provider: string; model?: string; effort?: string };
  status: StepStatus;
  startedAt: number;
  endedAt?: number;
  usage?: Usage;
  attempts?: number;
  error?: SerializedStepError;
  output?: unknown;
  schema?: unknown;
  sessionId?: string;
  transcriptRef?: BlobRef;
  patchRef?: string;
  childRunId?: string;
  presentation?: UiPresentation;
}

export interface HumanState {
  /** "h1", "h2", …: unique only together with the runId. */
  id: string;
  seq: number;
  /** Stable, e.g. "deps:review:1", "review:2", "memory:review". */
  key?: string;
  kind: HumanKind;
  question: string;
  phase?: string;
  detail?: string;
  risk?: Risk;
  schema: JsonSchema;
  status: HumanStatus;
  answer?: unknown;
  answeredBy?: AnsweredBy;
  deadline?: number;
  confirmToken?: string;
  artifactRef?: BlobRef;
  reviewSubject?: ReviewSubject;
  reviewAttachments?: ReviewAttachment[];
  reviewEdit?: ReviewEdit;
  requestedAt: number;
  ui?: UiPresentation;
}

export interface CheckState {
  name: string;
  status: "pass" | "fail";
  disposition: "executed" | "trusted" | "waived";
  summary?: string;
  evidence?: string;
  details?: CheckEvidence[];
  required: boolean;
}

export interface RunNote {
  kind: "decision" | "claim" | "risk";
  text: string;
  evidence?: string;
}

export interface RunState {
  /** 8 lowercase hex chars, e.g. "0035d37f". */
  runId: string;
  workflow: string;
  defHash?: string;
  status: RunStatus;
  input: unknown;
  output?: unknown;
  error?: SerializedStepError;
  createdAt: number;
  updatedAt: number;
  parentRunId?: string;
  depth: number;
  cwd: string;
  baseRef?: string;
  phases: Array<{ name: string; steps: number[] }>;
  steps: StepState[];
  humans: HumanState[];
  checks: CheckState[];
  notes: RunNote[];
  logs: string[];
  drops: Array<{ key?: string; seq?: number; reason: string }>;
  patches: {
    captured: Array<{ key: string; ref: string; files: string[]; outOfScope?: string[] }>;
    merged: Array<{ key: string; ref: string; conflicted?: boolean }>;
    discarded: Array<{ key: string; ref: string }>;
    violations: Array<{ key: string; files: string[]; mode: string }>;
  };
  /** Spend so far; tokens = input + output (cacheRead excluded). */
  budget: { tokens: number; usd: number };
  replay: { salvaged: number; diverged: number };
  children: Array<{ seq: number; childRunId: string }>;
  /** Number of journal records, which is also the next SSE index. */
  records: number;
}

/** `GET /api/runs/:id?detail=1` */
export interface RunDetail extends RunState {
  limits: { tokens?: number; usd?: number } | null;
  inputs: Record<number, unknown>;
}

export interface TreeNode {
  seq: number;
  kind: string;
  label: string;
  status: StepStatus;
  usage?: Usage;
  children: TreeNode[];
}
/** Steps without a phase land in "(no phase)"; human steps are not in the tree. */
export interface TreePhase {
  name: string;
  nodes: TreeNode[];
}

export interface RunSummary {
  runId: string;
  workflow: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  parentRunId?: string;
}
/** A row of `GET /api/runs`; `spend`, `steps` and `running` need `?spend=1`. */
export interface RunRow extends RunSummary {
  spend?: { tokens: number; usd: number };
  steps?: number;
  running?: number;
}

/** No key/phase here: join with RunState.humans[] by id to get them. */
export interface PendingRequest {
  runId: string;
  id: string;
  kind: HumanKind;
  question: string;
  detail?: string;
  schema: JsonSchema;
  risk?: Risk;
  createdAt: number;
  deadline?: number;
  confirmToken?: string;
  artifactRef?: BlobRef;
  reviewSubject?: ReviewSubject;
  reviewAttachments?: ReviewAttachment[];
  ui?: UiPresentation;
}
export interface PendingEntry extends PendingRequest {
  workflow: string;
  rootRunId: string;
  rootWorkflow: string;
}
/** `GET /api/pending`, oldest first. Group by rootRunId; post the answer to entry.runId. */
export interface PendingResponse {
  pending: PendingEntry[];
  unreadable: Array<{ runId: string; error: string }>;
}

export interface Meta {
  version: string;
  repo: { name: string; cwd: string; weftDir: string; runsDir: string };
  defaults: { provider: string; model?: string; effort?: string };
  limits: { concurrency: number; maxTurns: number; maxDepth: number; stepTimeoutMs: number };
  approvalPolicy: { tiers?: Partial<Record<Risk, ApprovalMode>>; actions?: Record<string, ApprovalMode> };
  fetchAllow: string[] | null;
  providers: Array<{ id: string; registered: boolean; concurrency?: number }>;
}

export interface WorkflowRow {
  id: string;
  name: string;
  file: string;
  description: string;
}
export interface WorkflowDetail extends WorkflowRow {
  hash: string;
  input: JsonSchema | null;
  output: JsonSchema | null;
  taskExtensions: JsonSchema | null;
  schemaWarnings: string[];
  taskExtensionSchemaVersion: number;
  tasksConfigured: boolean;
  defaults: { provider?: string; model?: string; effort?: string } | null;
}

export interface ArtifactEntry {
  ref: string;
  id: string;
  kind: "patch" | "artifact";
  size: number | null;
  producedBy: { seq: number; kind: string; label: string } | null;
  at: number | null;
  key?: string;
  files?: string[];
  preview?: string;
  gate?: { id: string; kind: string; question: string };
  available: boolean;
}

export interface FileStat {
  path: string;
  adds: number;
  dels: number;
  status: "added" | "deleted" | "modified" | "binary";
}
export interface PatchResponse {
  runId: string;
  patches: Array<{
    key: string;
    ref: string;
    files: string[];
    outOfScope: string[];
    merged: boolean;
    discarded: boolean;
    available: boolean;
    stats: FileStat[];
    diff?: string;
  }>;
}

// ---------------------------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------------------------

export type JournalEvent =
  | { type: "run.created"; runId: string; workflow: string; input: unknown; cwd: string; parentRunId?: string; depth: number; budget?: { tokens?: number; usd?: number } }
  | { type: "run.status"; status: RunStatus }
  | { type: "run.completed"; output: unknown }
  | { type: "run.failed"; error: SerializedStepError }
  | { type: "run.cancelled" }
  | { type: "phase"; name: string }
  | {
      type: "step.scheduled";
      seq: number;
      kind: StepKind;
      key?: string;
      label?: string;
      phase?: string;
      parentSeq?: number;
      route?: { provider: string; model?: string; effort?: string };
      payload?: unknown;
      schema?: unknown;
      childRunId?: string;
    }
  | { type: "step.completed"; seq: number; output?: unknown; usage?: Usage; transcriptRef?: BlobRef; patchRef?: string }
  | { type: "step.failed"; seq: number; error: SerializedStepError; phase?: string }
  | {
      type: "human.requested";
      id: string;
      seq: number;
      key?: string;
      kind: HumanKind;
      question: string;
      phase?: string;
      detail?: string;
      reviewSubject?: ReviewSubject;
      reviewAttachments?: ReviewAttachment[];
      schema: JsonSchema;
      risk?: Risk;
      confirmToken?: string;
    }
  | { type: "human.answered"; id: string; answer: unknown; answeredBy: AnsweredBy; channel?: "web" | "cli"; reviewEdit?: ReviewEdit }
  | { type: "human.superseded"; id: string; byId?: string; reason: string }
  | { type: "patch.captured"; seq: number; key: string; ref: string; files: string[] }
  | { type: "patch.merged"; key: string; ref: string; conflicted?: boolean }
  | { type: "patch.discarded"; key: string; ref: string }
  | ({ type: "check" } & CheckState)
  | ({ type: "note" } & RunNote)
  | { type: "budget.sampled"; tokens: number; usd: number }
  | { type: "log"; message: string };

export type JournalEventType = JournalEvent["type"];

export interface JournalRecord {
  /** 0-based index; also the SSE `id:`. */
  i: number;
  at: number;
  ev: JournalEvent;
}

/** Body of `POST /api/runs/:id/answer`. */
export interface AnswerBody {
  requestId: string;
  answer: unknown;
  /** Only when reviewSubject.kind === "file" && mode === "edit". */
  reviewEdit?: { content: string; beforeSha256: string };
}

/** Body of `POST /api/runs`. Budget: "500k" | "$5" | "500k,$5". */
export interface StartRunBody {
  workflow: string;
  input?: Record<string, unknown>;
  budget?: string | { tokens?: number; usd?: number };
  reuse?: "content" | "key";
}
