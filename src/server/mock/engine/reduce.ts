import "server-only";
/**
 * Journal fold: a port of weft's reduceState (core/src/projections.ts) plus the daemon's
 * detailOf (limits + per-step inputs). The mock journals exactly the events in
 * src/lib/weft/types.ts; the extra weft events (step.settled, human.rejected, drop,
 * scope.violation, replay.*) are folded too so a real weft journal reduces the same way.
 *
 * One addition: weft never journals `check` events (checks come from kind "check" steps),
 * but the mock's ctx.check() does, so they are folded into `checks` as well. A `check` event
 * right after a check step with the same name replaces that step's entry instead of doubling it.
 */
import type {
  BlobRef,
  CheckState,
  HumanState,
  JournalEvent,
  JournalRecord,
  ReviewEdit,
  RunDetail,
  RunState,
  StepState,
} from "@/lib/weft/types";

/** weft events the mock does not emit but a real journal may contain. */
type ExtraEvent =
  | { type: "step.settled"; seq: number }
  | { type: "step.attempt"; seq: number }
  | { type: "human.rejected"; id: string; reason: string }
  | { type: "drop"; seq?: number; key?: string; reason: string }
  | { type: "scope.violation"; seq: number; key: string; files: string[]; mode: string }
  | { type: "replay.salvaged"; seq: number }
  | { type: "replay.diverged"; seq: number; reason: string };

type AnyEvent = JournalEvent | ExtraEvent;

/** Optional fields weft journals that the mock's event types leave out. */
interface WeftExtras {
  attempts?: number;
  sessionId?: string;
  artifactRef?: BlobRef;
  deadline?: number;
}

function emptyState(records: number): RunState {
  return {
    runId: "",
    workflow: "",
    status: "planning",
    input: undefined,
    createdAt: 0,
    updatedAt: 0,
    depth: 0,
    cwd: "",
    phases: [],
    steps: [],
    humans: [],
    checks: [],
    notes: [],
    logs: [],
    drops: [],
    patches: { captured: [], merged: [], discarded: [], violations: [] },
    budget: { tokens: 0, usd: 0 },
    replay: { salvaged: 0, diverged: 0 },
    children: [],
    records,
  };
}

export function reduceState(records: readonly JournalRecord[]): RunState {
  const state = emptyState(records.length);
  // A resumed weft run can reuse a seq; every occurrence stays listed, completion applies to the latest.
  const allSteps: StepState[] = [];
  const stepsBySeq = new Map<number, StepState>();
  const humansById = new Map<string, HumanState>();
  const checkMetaBySeq = new Map<number, { name?: string; required: boolean }>();
  let currentPhase: string | undefined;
  // Index into state.checks of a check produced by a check step, until any other record lands.
  let lastStepCheck: number | undefined;

  for (const rec of records) {
    state.updatedAt = rec.at;
    const ev = rec.ev as AnyEvent;
    const extras = rec.ev as WeftExtras;
    const pendingStepCheck = lastStepCheck;
    lastStepCheck = undefined;
    switch (ev.type) {
      case "run.created": {
        state.runId = ev.runId;
        // Real weft journals { name, defHash, ... }; the mock journals the name.
        const wf = ev.workflow as unknown;
        if (typeof wf === "string") state.workflow = wf;
        else if (typeof wf === "object" && wf !== null) {
          const w = wf as { name?: string; defHash?: string };
          state.workflow = w.name ?? "";
          if (w.defHash !== undefined) state.defHash = w.defHash;
        }
        state.input = ev.input;
        state.createdAt = rec.at;
        state.depth = ev.depth;
        state.cwd = ev.cwd;
        if (ev.parentRunId !== undefined) state.parentRunId = ev.parentRunId;
        break;
      }
      case "run.status":
        state.status = ev.status;
        // A resumed run going nonterminal again must not keep showing the previous outcome.
        if (ev.status !== "cancelled" && ev.status !== "complete" && ev.status !== "failed") {
          delete state.output;
          delete state.error;
        }
        break;
      case "run.completed":
        state.status = "complete";
        state.output = ev.output;
        delete state.error;
        break;
      case "run.failed":
        state.status = "failed";
        state.error = ev.error;
        delete state.output;
        break;
      case "run.cancelled":
        state.status = "cancelled";
        break;
      case "phase":
        currentPhase = ev.name;
        if (!state.phases.some((p) => p.name === ev.name)) state.phases.push({ name: ev.name, steps: [] });
        break;
      case "step.scheduled": {
        const step: StepState = {
          seq: ev.seq,
          kind: ev.kind,
          status: "running",
          startedAt: rec.at,
          ...(ev.key !== undefined ? { key: ev.key } : {}),
          ...(ev.label !== undefined ? { label: ev.label } : {}),
          ...(ev.phase !== undefined ? { phase: ev.phase } : {}),
          ...(ev.parentSeq !== undefined ? { parentSeq: ev.parentSeq } : {}),
          ...(ev.route !== undefined ? { route: ev.route } : {}),
          ...(ev.schema !== undefined ? { schema: ev.schema } : {}),
          ...(ev.childRunId !== undefined ? { childRunId: ev.childRunId } : {}),
        };
        allSteps.push(step);
        stepsBySeq.set(ev.seq, step);
        if (ev.kind === "check") {
          const payload = ev.payload as { name?: string; required?: boolean } | undefined;
          checkMetaBySeq.set(ev.seq, {
            ...(payload?.name !== undefined ? { name: payload.name } : {}),
            required: payload?.required === true,
          });
        }
        const phaseName = ev.phase ?? currentPhase;
        if (phaseName) {
          let phase = state.phases.find((p) => p.name === phaseName);
          if (!phase) {
            phase = { name: phaseName, steps: [] };
            state.phases.push(phase);
          }
          if (!phase.steps.includes(ev.seq)) phase.steps.push(ev.seq);
        }
        if (ev.childRunId) state.children.push({ seq: ev.seq, childRunId: ev.childRunId });
        break;
      }
      case "step.completed": {
        const step = stepsBySeq.get(ev.seq);
        if (!step) break;
        step.status = "ok";
        step.endedAt = rec.at;
        step.output = ev.output;
        if (ev.usage !== undefined) step.usage = ev.usage;
        if (extras.attempts !== undefined) step.attempts = extras.attempts;
        if (extras.sessionId !== undefined) step.sessionId = extras.sessionId;
        if (ev.transcriptRef !== undefined) step.transcriptRef = ev.transcriptRef;
        if (ev.patchRef !== undefined) step.patchRef = ev.patchRef;
        if (step.kind === "check") {
          const out = ev.output as Partial<CheckState> | null | undefined;
          const meta = checkMetaBySeq.get(ev.seq);
          const name = meta?.name ?? step.label?.replace(/^check:/, "") ?? String(ev.seq);
          if (out?.status) {
            state.checks.push({
              name,
              status: out.status,
              disposition: out.disposition ?? "executed",
              required: meta?.required === true,
              ...(out.summary !== undefined ? { summary: out.summary } : {}),
              ...(out.evidence !== undefined ? { evidence: out.evidence } : {}),
              ...(out.details !== undefined ? { details: out.details } : {}),
            });
            lastStepCheck = state.checks.length - 1;
          }
        }
        break;
      }
      case "step.failed": {
        const step = stepsBySeq.get(ev.seq);
        if (!step) break;
        step.status = "failed";
        step.endedAt = rec.at;
        step.error = ev.error;
        if (extras.attempts !== undefined) step.attempts = extras.attempts;
        break;
      }
      case "step.settled": {
        const step = stepsBySeq.get(ev.seq);
        if (!step) break;
        step.status = "ok";
        step.endedAt = rec.at;
        delete step.error;
        break;
      }
      case "human.requested": {
        const human: HumanState = {
          id: ev.id,
          seq: ev.seq,
          kind: ev.kind,
          question: ev.question,
          schema: ev.schema,
          status: "pending",
          requestedAt: rec.at,
          ...(ev.key !== undefined ? { key: ev.key } : {}),
          ...(ev.phase !== undefined ? { phase: ev.phase } : {}),
          ...(ev.detail !== undefined ? { detail: ev.detail } : {}),
          ...(ev.risk !== undefined ? { risk: ev.risk } : {}),
          ...(extras.deadline !== undefined ? { deadline: extras.deadline } : {}),
          ...(ev.confirmToken !== undefined ? { confirmToken: ev.confirmToken } : {}),
          ...(extras.artifactRef !== undefined ? { artifactRef: extras.artifactRef } : {}),
          ...(ev.reviewSubject !== undefined ? { reviewSubject: ev.reviewSubject } : {}),
          ...(ev.reviewAttachments !== undefined ? { reviewAttachments: ev.reviewAttachments } : {}),
        };
        humansById.set(ev.id, human);
        state.humans.push(human);
        break;
      }
      case "human.answered": {
        // The FIRST standing answer wins, as in weft.
        const human = humansById.get(ev.id);
        if (!human || human.status === "answered") break;
        human.status = "answered";
        human.answer = ev.answer;
        human.answeredBy = ev.answeredBy;
        if (ev.reviewEdit !== undefined) human.reviewEdit = ev.reviewEdit as ReviewEdit;
        break;
      }
      case "human.rejected": {
        const human = humansById.get(ev.id);
        if (!human) break;
        human.status = "pending";
        delete human.answer;
        delete human.answeredBy;
        delete human.reviewEdit;
        break;
      }
      case "human.superseded": {
        const human = humansById.get(ev.id);
        if (human) human.status = "superseded";
        break;
      }
      case "check": {
        const { type: _type, ...rest } = ev;
        void _type;
        const check: CheckState = { ...rest, disposition: rest.disposition ?? "executed", required: rest.required === true };
        const prev = pendingStepCheck !== undefined ? state.checks[pendingStepCheck] : undefined;
        if (prev && prev.name === check.name) state.checks[pendingStepCheck!] = check;
        else state.checks.push(check);
        break;
      }
      case "note":
        state.notes.push({ kind: ev.kind, text: ev.text, ...(ev.evidence !== undefined ? { evidence: ev.evidence } : {}) });
        break;
      case "log":
        state.logs.push(ev.message);
        break;
      case "drop":
        state.drops.push({ reason: ev.reason, ...(ev.key !== undefined ? { key: ev.key } : {}), ...(ev.seq !== undefined ? { seq: ev.seq } : {}) });
        break;
      case "patch.captured": {
        const outOfScope = (ev as { outOfScope?: string[] }).outOfScope;
        state.patches.captured.push({ key: ev.key, ref: ev.ref, files: ev.files, ...(outOfScope !== undefined ? { outOfScope } : {}) });
        break;
      }
      case "patch.merged":
        state.patches.merged.push({ key: ev.key, ref: ev.ref, ...(ev.conflicted ? { conflicted: true } : {}) });
        break;
      case "patch.discarded":
        state.patches.discarded.push({ key: ev.key, ref: ev.ref });
        break;
      case "scope.violation":
        state.patches.violations.push({ key: ev.key, files: ev.files, mode: ev.mode });
        break;
      case "budget.sampled":
        state.budget = { tokens: ev.tokens, usd: ev.usd };
        break;
      case "replay.salvaged":
        state.replay.salvaged++;
        break;
      case "replay.diverged":
        state.replay.diverged++;
        break;
      default:
        break;
    }
  }
  state.steps = [...allSteps].sort((a, b) => a.seq - b.seq);
  return state;
}

/** `GET /api/runs/:id?detail=1`: the fold plus the budget ceiling and each step's payload. */
export function reduceDetail(records: readonly JournalRecord[]): RunDetail {
  let limits: RunDetail["limits"] = null;
  const inputs: Record<number, unknown> = {};
  for (const { ev } of records) {
    if (ev.type === "run.created") {
      const b = ev.budget;
      if (b && (b.tokens !== undefined || b.usd !== undefined)) limits = { ...b };
    } else if (ev.type === "step.scheduled" && ev.payload !== undefined) {
      inputs[ev.seq] = ev.payload;
    }
  }
  return { ...reduceState(records), limits, inputs };
}
