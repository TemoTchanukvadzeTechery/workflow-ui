import "server-only";
/**
 * The ScriptCtx a mock workflow runs against. Each call journals what weft would journal for
 * the equivalent SDK call (step.scheduled/completed/failed + budget.sampled, human.requested,
 * phase, check, note, log, patch.captured/merged, run.status). In a resumed pass, calls that
 * the journal already answers are served from it without new records or delays (see replay.ts).
 */
import type { ReviewAttachment, ReviewSubject, RunStatus, Usage } from "@/lib/weft/types";
import { GATE_SCHEMA } from "@/lib/weft/workflows";
import type { HumanOpts, ReviewOpts, ReviewResult, ScriptCtx, StepOpts } from "./api";
import { exhausted, usageFor } from "./budget";
import { CancelledError, StepError, type StepRef } from "./errors";
import type { Answered, Execution } from "./execution";
import { isTerminal, jsonClone, type CtxHost, type HumanRequestedEvent, type RunEntry } from "./internal";
import { applyDefaults } from "./validate";

export const DEFAULT_AGENT_ROUTE = { provider: "claude", model: "claude-opus-5", effort: "medium" } as const;

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function createScriptCtx(host: CtxHost, run: RunEntry, exec: Execution): ScriptCtx {
  const runId = run.runId;

  const guard = (): void => {
    if (exec.fenced) throw exec.fenceError ?? new CancelledError(`run ${runId} was cancelled`, { kind: "workflow", runId });
  };

  const append = (ev: Parameters<CtxHost["append"]>[1]) => host.append(run, ev);

  async function step<T>(opts: StepOpts<T>): Promise<T> {
    guard();
    const served = exec.serveStep(opts.key);
    if (served) {
      if (served.status === "failed") {
        const e = served.error;
        throw new StepError(e?.code ?? "internal", e?.message ?? "step failed", { step: e?.step ?? { key: opts.key, runId } });
      }
      return jsonClone(served.output) as T;
    }
    exec.live = true;

    const label = opts.label ?? opts.key;
    const paid = (opts.usd ?? 0) > 0 || (opts.tokens ?? 0) > 0;
    if (paid && exhausted(run.limits, run.spend)) {
      const remaining = (limit: number | undefined, spent: number) => (limit === undefined ? "null" : String(Math.max(0, round6(limit - spent))));
      const axis = run.limits?.tokens !== undefined && run.spend.tokens >= run.limits.tokens ? `${run.spend.tokens} tokens spent` : `$${run.spend.usd.toFixed(2)} spent`;
      throw new StepError(
        "budget_exceeded",
        `budget exhausted before step ${opts.key} (${axis}; remaining tokens=${remaining(run.limits?.tokens, run.spend.tokens)}, usd=${remaining(run.limits?.usd, run.spend.usd)})`,
        { step: { key: opts.key, kind: opts.kind, label, runId } },
      );
    }

    const seq = ++exec.seq;
    exec.lastStepSeq = seq;
    const ref: StepRef = { seq, key: opts.key, kind: opts.kind, label, runId };
    const route = opts.route ?? (opts.kind === "agent" ? { ...DEFAULT_AGENT_ROUTE } : undefined);
    append({
      type: "step.scheduled",
      seq,
      kind: opts.kind,
      key: opts.key,
      label,
      ...(exec.phase !== undefined ? { phase: exec.phase } : {}),
      ...(opts.parentSeq !== undefined ? { parentSeq: opts.parentSeq } : {}),
      ...(route !== undefined ? { route } : {}),
      ...(opts.payload !== undefined ? { payload: jsonClone(opts.payload) } : {}),
      ...(opts.schema !== undefined ? { schema: jsonClone(opts.schema) } : {}),
    });
    host.setStatus(run, opts.status ?? "executing");

    await host.clock.sleep(opts.ms, runId);
    guard();

    function fail(err: StepError): never {
      append({ type: "step.failed", seq, error: err.serialize() });
      throw err;
    }
    if (opts.fail) fail(new StepError(opts.fail.code, opts.fail.message, { step: ref }));

    let output: T;
    try {
      output = (typeof opts.output === "function" ? (opts.output as () => T)() : opts.output) as T;
    } catch (err) {
      // A thunk that throws fails this step; the error is re-attributed to it.
      fail(err instanceof StepError ? new StepError(err.code, err.message, { step: ref, detail: err.detail }) : StepError.from(err, ref));
    }

    const usage: Usage | undefined = usageFor(seq, opts.usd, opts.tokens);
    if (usage) {
      // weft samples the budget right before the step's completion record.
      append({
        type: "budget.sampled",
        tokens: run.spend.tokens + usage.input + usage.output,
        usd: round6(run.spend.usd + (usage.usd ?? 0)),
      });
    }
    append({ type: "step.completed", seq, output: jsonClone(output), ...(usage ? { usage } : {}) });
    return output;
  }

  function gate(question: string): Promise<void> {
    guard();
    if (exec.serveCounted("gates")) return Promise.resolve();
    exec.live = true;
    const id = `h${++run.humanCount}`;
    const seq = ++exec.seq;
    append({
      type: "human.requested",
      id,
      seq,
      kind: "gate",
      question,
      schema: GATE_SCHEMA,
      ...(exec.phase !== undefined ? { phase: exec.phase } : {}),
      risk: "low",
    });
    append({ type: "human.answered", id, answer: { approved: true }, answeredBy: "policy" });
    return Promise.resolve();
  }

  function answeredFromJournal(id: string): Answered {
    for (let i = run.records.length - 1; i >= 0; i--) {
      const ev = run.records[i]!.ev;
      if (ev.type !== "human.answered" || ev.id !== id) continue;
      const content = ev.reviewEdit ? host.blobs.get(ev.reviewEdit.ref.$blob) : undefined;
      return { answer: ev.answer, ...(ev.reviewEdit && content !== undefined ? { edited: { path: ev.reviewEdit.path, content } } : {}) };
    }
    throw new StepError("internal", `request ${id} has no journaled answer`, { step: { kind: "human", runId } });
  }

  /** Journal a request (or re-attach to one a resumed pass finds pending) and wait for it. */
  async function request(
    kind: "ask" | "review",
    opts: HumanOpts,
    build?: () => { subject: ReviewSubject; attachments: ReviewAttachment[] },
  ): Promise<Answered> {
    const served = exec.serveHuman(opts.key);
    if (served?.status === "answered") {
      let edited: Answered["edited"];
      if (served.reviewEdit) {
        const content = host.blobs.get(served.reviewEdit.ref.$blob);
        if (content !== undefined) {
          // A replayed script may have rewritten the file from its own draft: restore the edit.
          host.fs.write(served.reviewEdit.path, content);
          edited = { path: served.reviewEdit.path, content };
        }
      }
      return { answer: served.answer, ...(edited ? { edited } : {}) };
    }
    exec.live = true;
    if (served?.status === "pending") {
      // Answered between resume() and this pass reaching it: serve the journaled answer.
      if (run.humans.get(served.id)?.status === "answered") return answeredFromJournal(served.id);
      const waiting = exec.wait(served.id);
      host.setStatus(run, "waiting_for_human");
      host.humanOpened(run, served.id);
      return waiting;
    }

    // Subjects are blobbed only for a request that is actually journaled.
    const extra = build?.();
    const subject = extra?.subject;
    const attachments = extra?.attachments;
    const id = `h${++run.humanCount}`;
    const seq = ++exec.seq;
    // Register the wait before journaling, so an answer given from inside a listener lands.
    const waiting = exec.wait(id);
    const ev: HumanRequestedEvent = {
      type: "human.requested",
      id,
      seq,
      key: opts.key,
      kind,
      question: opts.question,
      ...(exec.phase !== undefined ? { phase: exec.phase } : {}),
      ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
      ...(subject !== undefined ? { reviewSubject: subject } : {}),
      ...(attachments !== undefined && attachments.length > 0 ? { reviewAttachments: attachments } : {}),
      schema: jsonClone(opts.schema),
      ...(opts.risk !== undefined ? { risk: opts.risk } : {}),
    };
    append(ev);
    host.setStatus(run, "waiting_for_human");
    host.humanOpened(run, id);
    return waiting;
  }

  async function ask<T>(opts: HumanOpts): Promise<T> {
    guard();
    const { answer } = await request("ask", opts);
    guard();
    return applyDefaults<T>(opts.schema, jsonClone(answer));
  }

  async function review<T>(opts: ReviewOpts): Promise<ReviewResult<T>> {
    guard();
    const build = (): { subject: ReviewSubject; attachments: ReviewAttachment[] } => {
      let subject: ReviewSubject;
      if (opts.subject.kind === "file") {
        const file = host.fs.read(opts.subject.path);
        if (!file) {
          throw new StepError("internal", `review subject ${opts.subject.path} is missing from the workspace`, {
            step: { kind: "human", key: opts.key, runId },
          });
        }
        subject = { kind: "file", path: file.path, mode: opts.subject.mode, ref: host.blobs.put(file.content), sha256: file.sha256 };
      } else {
        subject = {
          kind: "artifact",
          ref: host.blobs.put(opts.subject.content),
          ...(opts.subject.mediaType !== undefined ? { mediaType: opts.subject.mediaType } : {}),
          ...(opts.subject.label !== undefined ? { label: opts.subject.label } : {}),
        };
      }
      const attachments: ReviewAttachment[] = (opts.attachments ?? []).map((a) => ({
        kind: "artifact",
        ref: host.blobs.put(a.content),
        ...(a.mediaType !== undefined ? { mediaType: a.mediaType } : {}),
        ...(a.label !== undefined ? { label: a.label } : {}),
      }));
      return { subject, attachments };
    };
    const got = await request("review", opts, build);
    guard();
    return {
      answer: applyDefaults<T>(opts.schema, jsonClone(got.answer)),
      ...(got.edited ? { edited: got.edited } : {}),
    };
  }

  const ctx: ScriptCtx = {
    runId,
    workflow: run.workflow.id,
    input: run.input,
    meta: run.meta,
    phase(name: string) {
      guard();
      if (exec.phase === name) return;
      exec.phase = name;
      // A resumed pass never re-journals a phase the journal already has.
      if (exec.resuming && run.phases.has(name)) return;
      append({ type: "phase", name });
    },
    step,
    gate,
    ask,
    review,
    check(check) {
      guard();
      if (exec.serveCounted("checks")) return;
      exec.live = true;
      append({ type: "check", ...jsonClone(check), disposition: check.disposition ?? "executed", required: check.required === true });
    },
    note(note) {
      guard();
      if (exec.serveCounted("notes")) return;
      exec.live = true;
      append({ type: "note", ...jsonClone(note) });
    },
    patch(opts) {
      guard();
      const blob = host.blobs.put(opts.diff);
      const served = exec.servePatch(opts.key);
      if (served) return served;
      exec.live = true;
      const seq = opts.seq ?? exec.lastStepSeq ?? exec.seq;
      append({ type: "patch.captured", seq, key: opts.key, ref: blob.$blob, files: [...opts.files] });
      return blob.$blob;
    },
    merge(key: string, conflicted?: boolean) {
      guard();
      if (exec.serveMerge(key)) return;
      exec.live = true;
      let ref: string | undefined;
      for (let i = run.records.length - 1; i >= 0 && ref === undefined; i--) {
        const ev = run.records[i]!.ev;
        if (ev.type === "patch.captured" && ev.key === key) ref = ev.ref;
      }
      if (ref === undefined) throw new StepError("internal", `no captured patch ${key} to merge`, { step: { key, runId } });
      append({ type: "patch.merged", key, ref, ...(conflicted ? { conflicted: true } : {}) });
    },
    log(message: string) {
      guard();
      if (exec.serveCounted("logs")) return;
      exec.live = true;
      append({ type: "log", message });
    },
    status(status: RunStatus) {
      guard();
      if (isTerminal(status)) throw new Error(`ctx.status: ${status} is terminal; return from the script or throw instead`);
      if (!exec.live) return;
      host.setStatus(run, status);
    },
    blob(text: string) {
      return host.blobs.put(text);
    },
    fs: host.fs,
    now() {
      return host.clock.now();
    },
    async sleep(ms: number) {
      guard();
      if (!exec.live) return;
      await host.clock.sleep(ms, runId);
      guard();
    },
  };
  return ctx;
}

