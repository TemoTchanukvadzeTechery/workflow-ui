import "server-only";
/**
 * Run lifecycle: start, drive the script, answer, cancel, resume, plus the waits the seeder
 * uses (waitForHuman / waitForEnd). Every change goes through append(), which is the journal:
 * it stamps the record (i from 0, at = clock), updates the tracked fields and emits it.
 * Error texts are weft's (core/src/engine.ts answer/cancel, host input/budget checks).
 */
import { randomBytes } from "node:crypto";
import type {
  AnswerBody,
  JournalEvent,
  JournalRecord,
  PendingRequest,
  ReviewEdit,
  RunStatus,
  StartRunBody,
} from "@/lib/weft/types";
import { WeftApiError, type EngineEvent, type StartMeta } from "./api";
import type { BlobStore } from "./blobs";
import { budgetOf, type BudgetLimits } from "./budget";
import { defer, type Clock } from "./clock";
import { createScriptCtx } from "./ctx";
import { apiError, CancelledError, messageOf, StepError } from "./errors";
import { Execution } from "./execution";
import type { MapWorkspaceFs } from "./fs";
import { isTerminal, jsonClone, track, type CtxHost, type RunEntry } from "./internal";
import { appendRecord } from "./journal";
import { pendingRequestOf } from "./queries";
import { reduceState } from "./reduce";
import type { Registry } from "./registry";
import { WORKSPACE_CWD } from "./registry";
import { ReplayIndex } from "./replay";
import { assertMatches } from "./validate";

interface HumanWaiter {
  runId: string;
  key?: string;
  resolve(p: PendingRequest): void;
  reject(err: Error): void;
}

interface EndWaiter {
  runId: string;
  resolve(status: RunStatus): void;
}

function kebabCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/_/g, "-").toLowerCase();
}

export class Runner implements CtxHost {
  readonly runs = new Map<string, RunEntry>();
  private order = 0;
  private humanWaiters: HumanWaiter[] = [];
  private endWaiters: EndWaiter[] = [];

  constructor(
    readonly clock: Clock,
    readonly blobs: BlobStore,
    readonly fs: MapWorkspaceFs,
    private readonly registry: Registry,
    private readonly emit: (event: EngineEvent) => void,
  ) {}

  get(runId: string): RunEntry {
    const run = this.runs.get(runId);
    if (!run) throw apiError(`run ${runId} not found`);
    return run;
  }

  // -- journal ---------------------------------------------------------------------------

  append(run: RunEntry, ev: JournalEvent, actor?: string): JournalRecord {
    const record = appendRecord(run.records, ev, this.clock.stamp());
    track(run, record);
    this.emit({ runId: run.runId, record, workflow: run.workflow.id, meta: run.meta, ...(actor !== undefined ? { actor } : {}) });
    if (ev.type === "run.completed" || ev.type === "run.failed" || ev.type === "run.cancelled") this.ended(run);
    return record;
  }

  setStatus(run: RunEntry, status: RunStatus): void {
    if (run.status === status) return;
    this.append(run, { type: "run.status", status });
  }

  humanOpened(run: RunEntry, id: string): void {
    this.clock.skip(run.runId, false);
    const human = run.humans.get(id);
    if (!human || human.status !== "pending") return;
    const matching = this.humanWaiters.filter((w) => w.runId === run.runId && (w.key === undefined || w.key === human.request.key));
    if (matching.length === 0) return;
    this.humanWaiters = this.humanWaiters.filter((w) => !matching.includes(w));
    const pending = this.pendingRequest(run, id);
    for (const w of matching) w.resolve(pending);
  }

  private ended(run: RunEntry): void {
    this.clock.skip(run.runId, false);
    const ends = this.endWaiters.filter((w) => w.runId === run.runId);
    this.endWaiters = this.endWaiters.filter((w) => w.runId !== run.runId);
    for (const w of ends) w.resolve(run.status);
    const humans = this.humanWaiters.filter((w) => w.runId === run.runId);
    this.humanWaiters = this.humanWaiters.filter((w) => w.runId !== run.runId);
    for (const w of humans) {
      w.reject(new Error(`run ${run.runId} ended ${run.status} before asking${w.key !== undefined ? ` ${w.key}` : " a person"}`));
    }
  }

  private pendingRequest(run: RunEntry, id: string): PendingRequest {
    const human = reduceState(run.records).humans.find((h) => h.id === id);
    if (!human) throw apiError(`run ${run.runId}: no pending request ${id}`);
    return pendingRequestOf(run.runId, human);
  }

  // -- start -----------------------------------------------------------------------------

  start(body: StartRunBody, meta: StartMeta = {}): { ok: true; runId: string; workflow: string } {
    const raw = (body ?? {}) as unknown as Record<string, unknown>;
    const name = raw.workflow;
    if (typeof name !== "string" || name.trim() === "") throw apiError("start: workflow is required (a name from .weft/workflows)");
    if (/[/\\]/.test(name) || name.endsWith(".ts")) {
      throw apiError(`start: ${JSON.stringify(name)} looks like a path — this endpoint starts registry workflows only; use the CLI to run a file`);
    }
    const workflow = this.registry.get(name);
    if (!workflow) throw new WeftApiError(400, `unknown workflow ${name}`);

    const input = raw.input ?? {};
    if (typeof input !== "object" || input === null || Array.isArray(input)) throw apiError("start: input must be a JSON object");
    let limits: BudgetLimits | undefined;
    try {
      limits = budgetOf(raw.budget);
    } catch (err) {
      throw apiError(messageOf(err));
    }
    if (raw.reuse !== undefined && raw.reuse !== null && raw.reuse !== "content" && raw.reuse !== "key") {
      throw apiError('start: reuse must be "content" or "key"');
    }
    this.rejectUnknownInput(name, workflow.input, input as Record<string, unknown>);

    const rawInput = jsonClone(input as Record<string, unknown>);
    let parsed: unknown;
    try {
      parsed = workflow.parseInput(structuredClone(rawInput));
    } catch (err) {
      throw apiError(`input failed ${name}'s input schema: ${messageOf(err)}`);
    }

    const runId = this.newRunId();
    const run: RunEntry = {
      runId,
      workflow,
      meta: { ...meta },
      records: [],
      status: "planning",
      spend: { tokens: 0, usd: 0 },
      limits: limits && (limits.tokens !== undefined || limits.usd !== undefined) ? limits : null,
      input: parsed,
      humans: new Map(),
      humanCount: 0,
      maxSeq: 0,
      phases: new Set(),
      actors: new Map(),
      order: this.order++,
    };
    this.runs.set(runId, run);
    this.append(run, {
      type: "run.created",
      runId,
      workflow: name,
      // weft journals the raw input; the script sees the parsed one.
      input: rawInput,
      cwd: WORKSPACE_CWD,
      depth: 0,
      ...(run.limits ? { budget: { ...run.limits } } : {}),
    });
    this.append(run, { type: "run.status", status: "planning" });
    this.launch(run, new Execution(run));
    return { ok: true, runId, workflow: name };
  }

  private rejectUnknownInput(name: string, schema: Record<string, unknown>, input: Record<string, unknown>): void {
    const props = schema.properties;
    if (typeof props !== "object" || props === null) return;
    const declared = Object.keys(props);
    const dropped = Object.keys(input).filter((k) => !declared.includes(k));
    if (dropped.length === 0) return;
    const takes = declared.length > 0 ? ` — it takes ${[...declared].sort().map((k) => `--${kebabCase(k)}`).join(", ")}` : " — it takes no input";
    throw apiError(`${name} has no input field ${dropped.map((k) => `"${k}"`).join(", ")}${takes}`);
  }

  private newRunId(): string {
    for (;;) {
      const id = randomBytes(4).toString("hex");
      if (!this.runs.has(id)) return id;
    }
  }

  // -- drive -----------------------------------------------------------------------------

  /** Scripts start on a later macrotask so start() and resume() return before any step runs. */
  private launch(run: RunEntry, exec: Execution): void {
    run.exec = exec;
    defer(() => void this.drive(run, exec));
  }

  private async drive(run: RunEntry, exec: Execution): Promise<void> {
    if (exec.fenced) return;
    this.setStatus(run, "executing");
    try {
      const ctx = createScriptCtx(this, run, exec);
      const output = await run.workflow.script(ctx, run.input);
      if (exec.fenced) return;
      this.append(run, { type: "run.completed", output: output === undefined ? null : jsonClone(output) });
    } catch (err) {
      // Cancel and reset fence the pass and journal for it; its unwinding is silent.
      if (exec.fenced) return;
      const error = StepError.from(err, { kind: "workflow", runId: run.runId });
      this.append(run, { type: "run.failed", error: error.serialize() });
    } finally {
      // Waits a script left dangling stay pending rather than rejecting into nobody's hands.
      if (run.exec === exec) run.exec = undefined;
    }
  }

  // -- answer ----------------------------------------------------------------------------

  answer(runId: string, body: AnswerBody, actor?: string): { ok: true; woke: boolean } {
    const run = this.get(runId);
    const raw = (body ?? {}) as unknown as Record<string, unknown>;
    const requestId = raw.requestId;
    if (typeof requestId !== "string" || requestId === "") throw apiError("answer: requestId is required");
    if (!("answer" in raw)) throw apiError("answer: answer is required (use null for an empty answer)");
    let edit: { content: string; beforeSha256: string } | undefined;
    if (raw.reviewEdit !== undefined) {
      const re = raw.reviewEdit as Record<string, unknown> | null;
      if (typeof re !== "object" || re === null || Array.isArray(re) || typeof re.content !== "string" || typeof re.beforeSha256 !== "string") {
        throw apiError("answer: reviewEdit requires string content and beforeSha256");
      }
      edit = { content: re.content, beforeSha256: re.beforeSha256 };
    }

    const human = run.humans.get(requestId);
    if (!human) throw apiError(`run ${runId}: no pending request ${requestId}`);
    if (human.status === "superseded") throw apiError(`run ${runId}: request ${requestId} was superseded`);
    if (isTerminal(run.status)) throw apiError(`run ${runId} is already ${run.status} — resume it before answering`);
    if (human.status === "answered") throw apiError(`run ${runId}: request ${requestId} is already answered`);
    assertMatches(human.request.schema, raw.answer);

    let reviewEdit: ReviewEdit | undefined;
    if (edit) {
      const subject = human.request.reviewSubject;
      if (subject?.kind !== "file" || subject.mode !== "edit") throw apiError("this review request does not accept file edits");
      if (edit.beforeSha256 !== subject.sha256) throw apiError(`${subject.path} changed since this review opened`);
      const file = this.fs.write(subject.path, edit.content);
      reviewEdit = { path: subject.path, beforeSha256: edit.beforeSha256, afterSha256: file.sha256, ref: this.blobs.put(edit.content) };
    }

    const answer = raw.answer === undefined ? null : jsonClone(raw.answer);
    if (actor !== undefined) run.actors.set(requestId, actor);
    this.append(
      run,
      { type: "human.answered", id: requestId, answer, answeredBy: "human", channel: "web", ...(reviewEdit ? { reviewEdit } : {}) },
      actor,
    );
    // A script asking two people at once is still waiting until the last one answers.
    const stillWaiting = [...run.humans.values()].some((h) => h.status === "pending" && h.request.kind !== "gate");
    this.setStatus(run, stillWaiting ? "waiting_for_human" : "executing");
    run.exec?.deliver(requestId, { answer, ...(reviewEdit && edit ? { edited: { path: reviewEdit.path, content: edit.content } } : {}) });
    return { ok: true, woke: false };
  }

  // -- cancel / resume -------------------------------------------------------------------

  cancel(runId: string): { ok: true } {
    const run = this.get(runId);
    if (run.status === "cancelled") return { ok: true };
    if (run.status === "complete" || run.status === "failed") throw apiError(`run ${runId} is already ${run.status}`);
    const err = new CancelledError(`run ${runId} was cancelled`, { kind: "workflow", runId });
    run.exec?.fence(err);
    run.exec = undefined;
    this.clock.cancel(runId, err);
    // weft fails an in-flight step with a CancelledError before the run ends, so a cancelled
    // run's ledger never shows a step still running. Resume re-runs these (see replay.ts).
    for (const step of reduceState(run.records).steps) {
      if (step.status !== "running") continue;
      const ref = { seq: step.seq, kind: step.kind, runId, ...(step.key !== undefined ? { key: step.key } : {}), ...(step.label !== undefined ? { label: step.label } : {}) };
      this.append(run, { type: "step.failed", seq: step.seq, error: new CancelledError("run cancelled", ref).serialize(), phase: "execute" });
    }
    for (const [id, human] of run.humans) {
      if (human.status === "pending") this.append(run, { type: "human.superseded", id, reason: "run cancelled" });
    }
    this.append(run, { type: "run.cancelled" });
    this.append(run, { type: "run.status", status: "cancelled" });
    return { ok: true };
  }

  resume(runId: string): { ok: true; runId: string } {
    const run = this.get(runId);
    if (!isTerminal(run.status)) return { ok: true, runId };
    if (run.status === "complete") throw apiError(`run ${runId} is already complete`);
    const exec = new Execution(run, ReplayIndex.fromRecords(run.records));
    this.append(run, { type: "run.status", status: "executing" });
    this.launch(run, exec);
    return { ok: true, runId };
  }

  // -- waits -----------------------------------------------------------------------------

  waitForHuman(runId: string, key?: string): Promise<PendingRequest> {
    let run: RunEntry;
    try {
      run = this.get(runId);
    } catch (err) {
      return Promise.reject(err);
    }
    for (const [id, human] of run.humans) {
      if (human.status === "pending" && human.request.kind !== "gate" && (key === undefined || human.request.key === key)) {
        return Promise.resolve(this.pendingRequest(run, id));
      }
    }
    if (isTerminal(run.status)) {
      return Promise.reject(new Error(`run ${runId} is already ${run.status}; it will not ask${key !== undefined ? ` ${key}` : " anyone"}`));
    }
    return new Promise((resolve, reject) => this.humanWaiters.push({ runId, ...(key !== undefined ? { key } : {}), resolve, reject }));
  }

  waitForEnd(runId: string): Promise<RunStatus> {
    let run: RunEntry;
    try {
      run = this.get(runId);
    } catch (err) {
      return Promise.reject(err);
    }
    if (isTerminal(run.status)) return Promise.resolve(run.status);
    return new Promise((resolve) => this.endWaiters.push({ runId, resolve }));
  }

  fastForward(runId?: string): void {
    const targets = runId !== undefined ? [this.get(runId)] : [...this.runs.values()];
    for (const run of targets) {
      // Skip to the NEXT human step: a run already waiting on a person is left alone.
      if (isTerminal(run.status) || run.status === "waiting_for_human") continue;
      this.clock.skip(run.runId, true);
      this.clock.fastForward(run.runId);
    }
  }

  reset(): void {
    const err = new CancelledError("engine reset");
    for (const run of this.runs.values()) run.exec?.fence(err);
    this.clock.cancelAll(err);
    const humans = this.humanWaiters;
    const ends = this.endWaiters;
    this.humanWaiters = [];
    this.endWaiters = [];
    for (const w of humans) w.reject(new Error("engine reset"));
    for (const w of ends) w.resolve("cancelled");
    this.runs.clear();
  }
}
