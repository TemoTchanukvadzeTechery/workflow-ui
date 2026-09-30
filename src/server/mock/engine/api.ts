/**
 * Contract for the in-process mock weft engine. Workflow scripts (src/server/mock/workflows/*)
 * are written against ScriptCtx; the mock daemon routes and the delivery store use WeftBackend.
 * A real weft daemon can replace the engine behind WeftBackend (HttpWeftBackend) without the
 * delivery store changing.
 */
import type {
  AnswerBody,
  BlobRef,
  CheckState,
  HumanKind,
  JournalRecord,
  JsonSchema,
  Meta,
  PatchResponse,
  PendingRequest,
  PendingResponse,
  Risk,
  RunDetail,
  RunNote,
  RunRow,
  RunStatus,
  SerializedStepError,
  StartRunBody,
  StepKind,
  TreePhase,
  ArtifactEntry,
  WorkflowDetail,
  WorkflowRow,
} from "@/lib/weft/types";

// ---------------------------------------------------------------------------------------------
// What a mock workflow script sees
// ---------------------------------------------------------------------------------------------

export interface StepOpts<T> {
  kind: StepKind;
  /** Stable key, e.g. "draft:1", "atl:fetch:CP-50908", "check:unit". */
  key: string;
  label?: string;
  /**
   * Base duration in ms at "fast" speed. "instant" = 0, "realistic" = ×5.
   * The engine sleeps this long between step.scheduled and step.completed.
   */
  ms: number;
  /** Spend for this step; the engine accumulates it and journals budget.sampled. */
  usd?: number;
  /** Tokens for this step (input+output). Defaults to a plausible value derived from usd. */
  tokens?: number;
  /** Defaults to { provider: "claude", model: "claude-opus-5", effort: "medium" } for agent steps. */
  route?: { provider: string; model?: string; effort?: string };
  payload?: unknown;
  schema?: unknown;
  parentSeq?: number;
  /** The step's output, or a thunk evaluated when the step completes. */
  output?: T | (() => T);
  /** Make the step fail with this error (the script decides whether to continue). */
  fail?: Pick<SerializedStepError, "code" | "message">;
  /** Run status while the step runs, e.g. "integrating" or "verifying". Default "executing". */
  status?: RunStatus;
}

export type SubjectInput =
  | { kind: "file"; path: string; mode: "view" | "edit" }
  | { kind: "artifact"; content: string; mediaType?: string; label?: string };

export interface AttachmentInput {
  content: string;
  mediaType?: string;
  label?: string;
}

export interface HumanOpts {
  key: string;
  question: string;
  detail?: string;
  schema: JsonSchema;
  risk?: Risk;
}

export interface ReviewOpts extends HumanOpts {
  subject: SubjectInput;
  attachments?: AttachmentInput[];
}

export interface ReviewResult<T> {
  answer: T;
  /** Present when the reviewer edited a file subject; the engine has already written it. */
  edited?: { path: string; content: string };
}

export interface WorkspaceFile {
  path: string;
  content: string;
  sha256: string;
  updatedAt: number;
}

/**
 * The shared mock workspace, standing in for the po-workspace git repo: brd/<project>.md,
 * aad/<project>.md, plan/<project>.md, memory/memory.md (shared by all projects), notes/…
 */
export interface WorkspaceFs {
  read(path: string): WorkspaceFile | undefined;
  write(path: string, content: string): WorkspaceFile;
  list(prefix?: string): WorkspaceFile[];
}

export interface ScriptCtx<I = unknown> {
  readonly runId: string;
  readonly workflow: string;
  readonly input: I;
  /** Delivery metadata passed to start(); scripts may use it to pick content. */
  readonly meta: StartMeta;
  phase(name: string): void;
  step<T = unknown>(opts: StepOpts<T>): Promise<T>;
  /** A policy tool gate (kind "gate", risk "low", answeredBy "policy"). Never reaches a queue. */
  gate(question: string): Promise<void>;
  /** kind "ask"; resolves with the validated answer. */
  ask<T = unknown>(opts: HumanOpts): Promise<T>;
  /** kind "review"; resolves with the validated answer and any file edit. */
  review<T = unknown>(opts: ReviewOpts): Promise<ReviewResult<T>>;
  check(check: CheckState): void;
  note(note: RunNote): void;
  /** Journals patch.captured and stores the diff; returns the patch ref. */
  patch(opts: { seq?: number; key: string; files: string[]; diff: string }): string;
  merge(key: string, conflicted?: boolean): void;
  log(message: string): void;
  status(status: RunStatus): void;
  blob(text: string): BlobRef;
  fs: WorkspaceFs;
  sleep(ms: number): Promise<void>;
  /** The engine clock (virtual while seeding), so dates written into documents match the run's timestamps. Optional addition. */
  now?(): number;
}

export type Script<I = unknown, O = unknown> = (ctx: ScriptCtx<I>, input: I) => Promise<O>;

export interface MockWorkflow<I = unknown, O = unknown> {
  id: string;
  description: string;
  /** Shown as WorkflowRow.file, e.g. ".weft/workflows/po-brd/main.ts". */
  file: string;
  input: JsonSchema;
  output: JsonSchema | null;
  /** Apply schema defaults (like zod .default()) before the script sees the input. */
  parseInput(raw: unknown): I;
  defaults: { provider?: string; model?: string; effort?: string };
  /** true for po-brd / architect-aad (exist in weft today); false for SPEC workflows. */
  real: boolean;
  script: Script<I, O>;
}

/** Delivery-layer metadata carried alongside a run (not part of weft's run.created). */
export interface StartMeta {
  projectId?: string;
  /** The delivery project's display name, so mock content can title documents and code after it. */
  projectName?: string;
  taskId?: string;
  /** Who started it ("Acting as" name). */
  actor?: string;
}

// ---------------------------------------------------------------------------------------------
// What the daemon routes and the delivery store see
// ---------------------------------------------------------------------------------------------

export class WeftApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WeftApiError";
  }
}

export interface EngineEvent {
  runId: string;
  record: JournalRecord;
  workflow: string;
  meta: StartMeta;
  /** For human.answered records: the "Acting as" name that answered (weft itself records none). */
  actor?: string;
}

/**
 * The swap seam. MockEngine implements it in-process; HttpWeftBackend implements it with fetch
 * against http://127.0.0.1:4781/api/… (same method names as weft's endpoints).
 */
export interface WeftBackend {
  meta(): Promise<Meta>;
  workflows(): Promise<WorkflowRow[]>;
  workflow(name: string): Promise<WorkflowDetail>;
  runs(filter?: { status?: RunStatus; workflow?: string; limit?: number; spend?: boolean }): Promise<RunRow[]>;
  start(body: StartRunBody, meta?: StartMeta): Promise<{ ok: true; runId: string; workflow: string }>;
  run(runId: string): Promise<RunDetail>;
  journal(runId: string, from?: number): Promise<JournalRecord[]>;
  tree(runId: string): Promise<TreePhase[]>;
  report(runId: string): Promise<string>;
  runPending(runId: string): Promise<PendingRequest[]>;
  pending(): Promise<PendingResponse>;
  answer(runId: string, body: AnswerBody, actor?: string): Promise<{ ok: true; woke: boolean }>;
  cancel(runId: string): Promise<{ ok: true }>;
  resume(runId: string): Promise<{ ok: true; runId: string }>;
  artifacts(runId: string): Promise<ArtifactEntry[]>;
  patch(runId: string, opts?: { key?: string; statsOnly?: boolean }): Promise<PatchResponse>;
  blobText(ref: string): Promise<string>;
  /** Every journal record of every run, as it is appended. Returns an unsubscribe function. */
  subscribe(listener: (event: EngineEvent) => void): () => void;
}

/** Mock-only controls on top of WeftBackend. */
export interface MockEngineControls {
  fs: WorkspaceFs;
  putBlob(text: string): BlobRef;
  metaOf(runId: string): StartMeta | undefined;
  /** The "Acting as" name that answered a human request (weft itself records none). Optional addition. */
  actorOf?(runId: string, requestId: string): string | undefined;
  /** Resolve every pending sleep immediately (the "Skip to next human step" debug button). */
  fastForward(runId?: string): void;
  /**
   * Virtual time for seeding: while active, sleeps resolve immediately and `now()` advances by
   * each step's realistic duration from `startAt`, so seeded runs have believable timestamps.
   */
  withVirtualClock<T>(startAt: number, fn: () => Promise<T>): Promise<T>;
  now(): number;
  /** Resolves when the run next waits on a human request with this key (or any key if omitted). */
  waitForHuman(runId: string, key?: string): Promise<PendingRequest>;
  /** Resolves when the run reaches a terminal status. */
  waitForEnd(runId: string): Promise<RunStatus>;
  reset(): void;
}

export type MockEngine = WeftBackend & MockEngineControls;

export type { HumanKind };
