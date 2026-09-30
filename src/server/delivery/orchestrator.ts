import "server-only";
/**
 * Reacts to weft journal records (WeftBackend.subscribe) and keeps the delivery layer in step,
 * per SPEC 4.2: document versions and acceptance, epics, plan → tasks, dev-task progress, QA
 * evidence and verdicts, the QA loop-back, notifications. Events are handled strictly in order
 * on one promise chain; `drain()` waits for it (seeding relies on that).
 */
import type { Actor, AadReport, Dependency, DraftReport, StageId } from "@/lib/delivery/types";
import type { CheckState, JournalEvent, ReviewSubject } from "@/lib/weft/types";
import type {
  DevPlanOutput,
  DevTaskInput,
  DevTaskOutput,
  DocWorkflowOutput,
  ImplementStepOutput,
  QaReportStepOutput,
  QaVerifyOutput,
} from "@/lib/weft/workflows";
import type { EngineEvent } from "@/server/mock/engine/api";
import { humanHref } from "./derive";
import { parseDraftReport } from "./parse";
import { taskLabel, workflowStage } from "./rules";
import { reqKey, type ProjectData, type StoredDoc } from "./state";
import type { DeliveryStore } from "./store";
import { DEFAULT_ACTOR_NAME, SYSTEM, agent, asStringArray, errorMessage, human, isRecord, plural, shorten } from "./util";

type Ev<T extends JournalEvent["type"]> = Extract<JournalEvent, { type: T }>;

const DOC_WORKFLOWS: Record<string, "brd" | "aad"> = { "po-brd": "brd", "architect-aad": "aad" };
const KIND_LABEL = { brd: "BRD", aad: "AAD", plan: "plan" } as const;

function asReport(x: unknown, path: string): DraftReport | AadReport | undefined {
  if (!isRecord(x)) return undefined;
  if (Array.isArray(x.blockingQuestions)) {
    const r: AadReport = {
      path: typeof x.path === "string" ? x.path : path,
      missingSections: asStringArray(x.missingSections),
      blockingQuestions: asStringArray(x.blockingQuestions),
      conflicts: asStringArray(x.conflicts),
      ignoredInstructions: asStringArray(x.ignoredInstructions),
      changes: asStringArray(x.changes),
      untracedRequirements: asStringArray(x.untracedRequirements),
      decisionsNeeded: asStringArray(x.decisionsNeeded),
    };
    if (!Array.isArray(x.untracedRequirements) && !Array.isArray(x.decisionsNeeded)) {
      const { untracedRequirements: _u, decisionsNeeded: _d, ...brd } = r;
      void _u;
      void _d;
      return brd;
    }
    return r;
  }
  return asReport(x.report, path) ?? asReport(x.lastReport, path);
}

const CHECK_WORDS: Record<string, string> = { typecheck: "typecheck", lint: "lint", unit: "unit tests", contract: "contract tests", e2e: "E2E tests", api: "API tests" };

/**
 * A dev-task or qa-verify step label in plain words for task.latestStep. The ledger keeps weft's
 * labels ("rework:1:T-2 · editing X"); task rows and cards show what the agent is doing.
 */
export function stepText(label: string | undefined, key: string | undefined, kind: string): string {
  const raw = (label ?? key ?? "").trim();
  const [head = "", detail = ""] = raw.split(/\s+·\s+/, 2);
  const editing = /^(?:editing|QA rework in)\s+(.+)$/i.exec(detail)?.[1];
  let m: RegExpExecArray | null;
  if (/^implement:/.test(head)) {
    if (/^QA rework in /i.test(detail)) return `Fixing the QA bugs${editing ? ` (editing ${editing})` : ""}`;
    return `Implementing${editing ? `: editing ${editing}` : ""}`;
  }
  if ((m = /^rework:(\d+):/.exec(head))) return `Rework ${m[1]}${editing ? `: editing ${editing}` : ""}`;
  if ((m = /^fix:(\d+)$/.exec(head))) {
    const check = /^check:(\w+)(?:\s+in\s+(.+))?$/.exec(detail);
    return check ? `Fixing the failing ${CHECK_WORDS[check[1]] ?? check[1]}${check[2] ? ` in ${check[2]}` : ""}` : `Fix ${m[1]}${detail ? `: ${detail}` : ""}`;
  }
  if ((m = /^(?:check|qa):(\w+)$/.exec(head))) {
    if (m[1] === "plan") return "Writing the test plan";
    if (m[1] === "manual") return "Testing by hand in the browser";
    return `Running ${CHECK_WORDS[m[1]] ?? m[1]}`;
  }
  if ((m = /^git\.branch\s+(\S+)/.exec(head))) return `Checking out ${m[1]}`;
  if (/^integrate:/.test(head)) return "Merging into the task branch";
  if (/^report$/.test(head)) return "Writing the evidence report";
  return raw || `Running ${kind} step`;
}

/** "- <ref> [<kind>, <relation>] <title>\n  <why>" → ref → why. */
function whyByRef(detail: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!detail) return out;
  const lines = detail.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s+(\S+)\s+\[/);
    const next = lines[i + 1];
    if (m && next && /^\s{2,}\S/.test(next)) out.set(m[1], next.trim());
  }
  return out;
}

export class Orchestrator {
  private queue: Promise<void> = Promise.resolve();
  private depth = 0;
  private generation = 0;
  private unsubscribe?: () => void;
  private steps = new Map<string, Map<number, { key?: string; label?: string; kind: string }>>();
  private drafts = new Map<string, unknown>();
  private approvers = new Map<string, string>();
  private memoryBy = new Map<string, string>();
  private depsDetail = new Map<string, string>();
  private gates = new Map<string, number>();

  constructor(private readonly store: DeliveryStore) {}

  start(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.store.weft.subscribe((e) => this.onEvent(e));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** Forget per-run caches and drop queued events from before a reset. */
  reset(): void {
    this.generation++;
    for (const m of [this.steps, this.drafts, this.approvers, this.memoryBy, this.depsDetail, this.gates]) m.clear();
  }

  /** Resolves once every event received so far (and whatever it triggered) is handled. */
  async drain(): Promise<void> {
    while (this.depth > 0) await this.queue;
  }

  private onEvent(e: EngineEvent): void {
    const ev = e.record.ev;
    const projectId = e.meta.projectId;
    const status =
      ev.type === "run.status" ? ev.status : ev.type === "run.completed" ? "complete" : ev.type === "run.failed" ? "failed" : ev.type === "run.cancelled" ? "cancelled" : undefined;
    // Live hints go out immediately; the bus coalesces bursts.
    this.store.bus.publish({ type: "run", runId: e.runId, ...(projectId ? { projectId } : {}), ...(status ? { status } : {}) });
    if (ev.type === "human.requested" || ev.type === "human.answered" || ev.type === "human.superseded" || status === "complete" || status === "failed" || status === "cancelled")
      this.store.bus.publish({ type: "inbox" });
    const gen = this.generation;
    this.depth++;
    this.queue = this.queue
      .then(() => (gen === this.generation ? this.handle(e) : undefined))
      .catch((err) => console.error(`[orchestrator] ${e.workflow} ${e.runId} ${ev.type}:`, err))
      .finally(() => {
        this.depth--;
      });
  }

  private async handle(e: EngineEvent): Promise<void> {
    const pid = e.meta.projectId;
    if (!pid) return;
    const pd = this.store.find(pid);
    if (!pd) return;
    const ev = e.record.ev;
    switch (ev.type) {
      case "run.created":
        return this.onCreated(pd, e, ev);
      case "phase":
        return this.onPhase(pd, e, ev.name);
      case "step.scheduled":
        return this.onStepScheduled(pd, e, ev);
      case "step.completed":
        return this.onStepCompleted(pd, e, ev);
      case "check":
        return this.onCheck(pd, e, ev);
      case "human.requested":
        return this.onHumanRequested(pd, e, ev);
      case "human.answered":
        return this.onHumanAnswered(pd, e, ev);
      case "human.superseded":
        this.store.touch(pd, e.record.at);
        return;
      case "run.completed":
        return this.onCompleted(pd, e, ev);
      case "run.failed":
        return this.onFailed(pd, e, ev);
      case "run.cancelled":
        return this.onCancelled(pd, e);
      default:
        return;
    }
  }

  // -------------------------------------------------------------------------------------------

  private stageOf(e: EngineEvent): StageId {
    return this.store.owners.get(e.runId)?.stage ?? workflowStage(e.workflow, this.store.inputs.get(e.runId));
  }

  /** The task this run works on, only while it is the task's latest run of that workflow. */
  private taskOf(pd: ProjectData, e: EngineEvent) {
    const taskId = e.meta.taskId ?? this.store.owners.get(e.runId)?.taskId;
    const task = taskId ? pd.tasks.find((t) => t.id === taskId) : undefined;
    if (!task) return undefined;
    const runs = e.workflow === "qa-verify" ? task.qa.runIds : task.runIds;
    return runs.at(-1) === e.runId || !runs.includes(e.runId) ? task : undefined;
  }

  private answeredBy(e: EngineEvent, runId = e.runId): string {
    return this.approvers.get(runId) ?? e.meta.actor ?? DEFAULT_ACTOR_NAME;
  }

  private onCreated(pd: ProjectData, e: EngineEvent, ev: Ev<"run.created">): void {
    this.store.inputs.set(e.runId, ev.input);
    this.store.registerRun(pd.project.id, workflowStage(e.workflow, ev.input), e.runId, e.workflow, e.meta.taskId);
    const task = this.taskOf(pd, e);
    if (task && e.workflow === "qa-verify") task.qa.status = "testing";
    this.store.touch(pd, e.record.at);
  }

  private onPhase(pd: ProjectData, e: EngineEvent, name: string): void {
    this.store.phases.set(e.runId, name);
    const task = this.taskOf(pd, e);
    if (task && e.workflow === "dev-task" && !["done", "cancelled", "blocked"].includes(task.status)) {
      // A rework cycle keeps "changes requested" until the agent re-verifies.
      if (/^(prepare|implement)/i.test(name) && task.status !== "changes_requested") task.status = "in_progress";
      else if (/^(verify|integrate|review)/i.test(name)) task.status = "verifying";
    }
    if (task && e.workflow === "qa-verify" && task.qa.status !== "in_review") task.qa.status = "testing";
    this.store.touch(pd, e.record.at);
  }

  private onStepScheduled(pd: ProjectData, e: EngineEvent, ev: Ev<"step.scheduled">): void {
    let steps = this.steps.get(e.runId);
    if (!steps) this.steps.set(e.runId, (steps = new Map()));
    steps.set(ev.seq, { key: ev.key, label: ev.label, kind: ev.kind });
    if (ev.kind === "human") return;
    const task = this.taskOf(pd, e);
    if (task && (e.workflow === "dev-task" || e.workflow === "qa-verify")) {
      task.latestStep = stepText(ev.label, ev.key, ev.kind);
      this.store.touch(pd, e.record.at);
    }
  }

  private onStepCompleted(pd: ProjectData, e: EngineEvent, ev: Ev<"step.completed">): void {
    const info = this.steps.get(e.runId)?.get(ev.seq);
    const key = info?.key ?? "";
    if (DOC_WORKFLOWS[e.workflow] && key.startsWith("draft:")) this.drafts.set(e.runId, ev.output);
    const task = this.taskOf(pd, e);
    if (!task) return;
    if (e.workflow === "dev-task" && /^(implement|rework):/.test(key) && isRecord(ev.output)) {
      const out = ev.output as Partial<ImplementStepOutput>;
      if (out.diffStats) task.diffStats = out.diffStats;
      this.store.touch(pd, e.record.at);
    }
    if (e.workflow === "qa-verify" && key === "report" && isRecord(ev.output)) this.store.attachEvidence(pd, task, e.runId, ev.output as unknown as QaReportStepOutput, e.record.at);
  }

  private onCheck(pd: ProjectData, e: EngineEvent, ev: Ev<"check">): void {
    if (e.workflow !== "dev-task") return;
    const task = this.taskOf(pd, e);
    if (!task) return;
    const { type: _t, ...check } = ev;
    void _t;
    const i = task.checks.findIndex((c) => c.name === check.name);
    if (i >= 0) task.checks[i] = check as CheckState;
    else task.checks.push(check as CheckState);
    this.store.touch(pd, e.record.at);
  }

  private async onHumanRequested(pd: ProjectData, e: EngineEvent, ev: Ev<"human.requested">): Promise<void> {
    const at = e.record.at;
    this.store.requests.set(reqKey(e.runId, ev.id), { key: ev.key, phase: ev.phase, kind: ev.kind, question: ev.question, detail: ev.detail });
    if (ev.kind === "gate") {
      // Policy tool gates never reach a queue; they are summarised when the run ends.
      this.gates.set(e.runId, (this.gates.get(e.runId) ?? 0) + 1);
      return;
    }
    const key = ev.key ?? "";
    const stage = this.stageOf(e);
    const task = this.taskOf(pd, e);
    const href = humanHref(pd.project.id, { runId: e.runId, id: ev.id }, this.store);
    const docKind = DOC_WORKFLOWS[e.workflow];

    if (key.startsWith("deps:review:")) this.depsDetail.set(e.runId, ev.detail ?? "");
    if (docKind && key.startsWith("review:")) await this.snapshotDoc(pd, docKind, e, ev.reviewSubject, key, at, ev.reviewAttachments);
    if (e.workflow === "dev-plan" && key.startsWith("plan:review:")) await this.snapshotDoc(pd, "plan", e, ev.reviewSubject, key, at);

    const extra = { runId: e.runId, requestId: ev.id, href, ...(task ? { taskId: task.id } : {}) };
    if (task && key.startsWith("task:review:")) {
      task.status = "in_review";
      task.latestStep = "Awaiting review";
      if (/^escalated/i.test(ev.question)) task.escalated = true;
      const passed = task.checks.filter((c) => c.status === "pass").length;
      this.store.log(pd, stage, "task.status", agent("dev-task"), `Agent completed ${taskLabel(task)} · ${passed}/${task.checks.length} checks passed · awaiting review`, extra, at);
      this.store.notify({ level: "attention", title: `${taskLabel(task)} ready for review`, body: `${pd.project.name}: ${shorten(ev.question, 120)}`, href, projectId: pd.project.id });
      return;
    }
    if (task && key.startsWith("qa:review:")) {
      task.qa.status = "in_review";
      task.latestStep = "Awaiting QA review";
    }
    this.store.log(pd, stage, "human.requested", agent(e.workflow), `${e.workflow} needs input: ${shorten(ev.question, 110)}`, extra, at);
    this.store.notify({ level: "attention", title: `${e.workflow} needs your input`, body: `${pd.project.name}: ${shorten(ev.question, 120)}`, href, projectId: pd.project.id });
  }

  /** review:N / plan:review:N opened: the file subject becomes a new agent DocVersion. */
  private async snapshotDoc(
    pd: ProjectData,
    kind: "brd" | "aad" | "plan",
    e: EngineEvent,
    subject: ReviewSubject | undefined,
    key: string,
    at: number,
    attachments?: Ev<"human.requested">["reviewAttachments"],
  ): Promise<void> {
    if (!subject || subject.kind !== "file") return;
    const doc = this.store.ensureDoc(pd, kind, subject.path);
    doc.path = subject.path;
    const round = Number(key.split(":").at(-1)) || 1;
    const version = this.store.addVersion(doc, {
      sha256: subject.sha256,
      blob: subject.ref.$blob,
      at,
      source: "agent",
      runId: e.runId,
      roundKey: key,
      ...(round > 1 ? { reason: "Regenerated after your feedback" } : {}),
    });
    doc.status = "draft";
    delete doc.acceptedBy;
    delete doc.acceptedAt;
    const text = await this.blobText(subject.ref.$blob);
    if (text) this.store.applyParse(doc, text);
    if (kind !== "plan") {
      const report = await this.draftReport(e, round, subject.path, attachments);
      if (report) doc.lastReport = report;
    }
    if (version)
      this.store.log(pd, this.stageOf(e), "artifact.produced", agent(e.workflow), `${e.workflow} produced ${KIND_LABEL[kind]} draft v${version.n} (round ${round})`, {
        runId: e.runId,
        href: `/projects/${pd.project.id}/docs/${doc.id}?v=${version.n}`,
      }, at);
  }

  private async blobText(ref: string): Promise<string> {
    try {
      return await this.store.weft.blobText(ref);
    } catch {
      return "";
    }
  }

  /** The draft step output, else the run's draft:<round> step, else the "draft report" attachment. */
  private async draftReport(e: EngineEvent, round: number, path: string, attachments?: Ev<"human.requested">["reviewAttachments"]) {
    const cached = asReport(this.drafts.get(e.runId), path);
    if (cached) return cached;
    try {
      const run = await this.store.weft.run(e.runId);
      const step = run.steps.filter((s) => s.key === `draft:${round}`).at(-1) ?? [...run.steps].reverse().find((s) => asReport(s.output, path));
      const fromRun = asReport(step?.output, path);
      if (fromRun) return fromRun;
    } catch {
      // fall through to the attachment
    }
    const att = attachments?.find((a) => /report/i.test(a.label ?? ""));
    if (!att) return undefined;
    const md = await this.blobText(att.ref.$blob);
    return md ? parseDraftReport(md, path) : undefined;
  }

  private async onHumanAnswered(pd: ProjectData, e: EngineEvent, ev: Ev<"human.answered">): Promise<void> {
    const info = this.store.requests.get(reqKey(e.runId, ev.id));
    if (info?.kind === "gate" || ev.answeredBy === "policy") return;
    const at = e.record.at;
    const key = info?.key ?? "";
    const name = e.actor ?? DEFAULT_ACTOR_NAME;
    const actor: Actor = ev.answeredBy === "timeout" ? SYSTEM : human(name);
    const a = isRecord(ev.answer) ? ev.answer : {};
    const stage = this.stageOf(e);
    const task = this.taskOf(pd, e);
    const docKind = DOC_WORKFLOWS[e.workflow];
    const feedback = typeof a.feedback === "string" && a.feedback.trim() ? a.feedback.trim() : "";
    const round = key.split(":").at(-1);
    let type: Parameters<DeliveryStore["log"]>[2] = "human.answered";
    let text = `answered ${e.workflow} request ${ev.id}`;

    if (ev.reviewEdit && (docKind || e.workflow === "dev-plan")) {
      const kind = docKind ?? "plan";
      const doc = this.store.docOf(pd, kind);
      if (doc) {
        const version = this.store.addVersion(doc, { sha256: ev.reviewEdit.afterSha256, blob: ev.reviewEdit.ref.$blob, at, source: "human-edit", runId: e.runId, roundKey: key, reason: `Edited by ${name} in review` });
        const edited = await this.blobText(ev.reviewEdit.ref.$blob);
        if (edited) this.store.applyParse(doc, edited);
        if (version)
          this.store.log(pd, stage, "artifact.produced", actor, `${actor.kind === "human" ? name : "Timeout"} edited the ${KIND_LABEL[kind]} (v${version.n})`, {
            runId: e.runId,
            requestId: ev.id,
            href: `/projects/${pd.project.id}/docs/${doc.id}?v=${version.n}`,
          }, at);
      }
    }

    if (key.startsWith("deps:review:")) {
      const detail = this.depsDetail.get(e.runId) ?? info?.detail ?? "";
      const listed = detail.split(/\r?\n/).filter((l) => /^\s*-\s+\S/.test(l) && !/none found/i.test(l)).length;
      const n = Math.max(0, listed - asStringArray(a.remove).length + asStringArray(a.add).length);
      text = a.decision === "search-more" ? `asked for more discovery${typeof a.guidance === "string" && a.guidance ? `: ${shorten(a.guidance, 80)}` : ""}` : `answered dependency review: continue with ${plural(n, "source")}`;
    } else if (docKind && key.startsWith("review:")) {
      if (a.decision === "accept") this.approvers.set(e.runId, name);
      text = a.decision === "accept" ? `accepted the ${KIND_LABEL[docKind]} draft (round ${round})` : `asked for a ${KIND_LABEL[docKind]} revision (round ${round})${feedback ? `: ${shorten(feedback, 80)}` : ""}`;
    } else if (key.startsWith("memory:review")) {
      if (a.decision === "apply") this.memoryBy.set(e.runId, name);
      text = a.decision === "apply" ? `applied the memory update${typeof a.replacement === "string" ? " (edited)" : ""}` : "discarded the memory update";
    } else if (key.startsWith("plan:review:")) {
      if (a.decision === "approve") this.approvers.set(e.runId, name);
      text = a.decision === "approve" ? `approved the implementation plan (round ${round})` : `asked for a plan revision${feedback ? `: ${shorten(feedback, 80)}` : ""}`;
    } else if (key.startsWith("task:review:") && task) {
      const label = taskLabel(task);
      if (a.decision === "approve") {
        task.devReview = this.store.decision(pd, "approved", actor, at, feedback || undefined);
        type = "task.approved";
        text = `approved ${label}`;
      } else if (a.decision === "request-changes") {
        task.devReview = this.store.decision(pd, "changes_requested", actor, at, feedback || undefined);
        task.status = "changes_requested";
        task.reworkCount += 1;
        task.reworkFrom = "developer";
        if (feedback) task.lastFeedback = feedback;
        type = "task.changes_requested";
        text = `requested changes on ${label}${feedback ? `: ${shorten(feedback, 80)}` : ""}`;
      } else if (a.decision === "cancel") {
        task.devReview = this.store.decision(pd, "changes_requested", actor, at, feedback || "Cancelled");
        type = "task.status";
        text = `cancelled ${label}`;
      }
    } else if (key.startsWith("qa:review:") && task) {
      const label = taskLabel(task);
      const comment = typeof a.comment === "string" && a.comment.trim() ? a.comment.trim() : undefined;
      task.qa.review = this.store.decision(pd, a.verdict === "ready-for-po-review" ? "approved" : "changes_requested", actor, at, comment);
      type = "qa.verdict";
      const bugs = asStringArray(a.bugs);
      text = a.verdict === "ready-for-po-review" ? `certified ${label}` : a.verdict === "bugs-found" ? `reported ${plural(bugs.length || 1, "bug")} on ${label}` : `marked ${label} blocked for QA`;
    }
    const href = task ? `/projects/${pd.project.id}/tasks/${task.id}` : `/projects/${pd.project.id}/${stage}`;
    this.store.log(pd, stage, type, actor, `${actor.kind === "human" ? name : "Timeout"} ${text}`, { runId: e.runId, requestId: ev.id, href, ...(task ? { taskId: task.id } : {}) }, at);
  }

  private async onCompleted(pd: ProjectData, e: EngineEvent, ev: Ev<"run.completed">): Promise<void> {
    const at = e.record.at;
    const docKind = DOC_WORKFLOWS[e.workflow];
    if (docKind) await this.completeDocRun(pd, e, docKind, (ev.output ?? {}) as DocWorkflowOutput<DraftReport>, at);
    else if (e.workflow === "dev-plan") await this.completePlan(pd, e, (ev.output ?? {}) as DevPlanOutput, at);
    else if (e.workflow === "dev-task") await this.completeDevTask(pd, e, (ev.output ?? {}) as DevTaskOutput, at);
    else if (e.workflow === "qa-verify") await this.completeQa(pd, e, (ev.output ?? {}) as QaVerifyOutput, at);
    const gates = this.gates.get(e.runId);
    if (gates) this.store.log(pd, this.stageOf(e), "gate.auto_approved", { kind: "policy" }, `${plural(gates, "tool gate")} auto-approved by policy`, { runId: e.runId, href: `/runs/${e.runId}` }, at);
    if (e.workflow !== "qa-verify") this.store.notify({ ...this.completedNotice(pd, e, ev.output), body: `${pd.project.name} · ${e.workflow} run ${e.runId}`, projectId: pd.project.id });
    this.forget(e.runId);
  }

  /** What a finished run means, for its toast (qa-verify notifies from completeQa with the verdict). */
  private completedNotice(pd: ProjectData, e: EngineEvent, output: unknown): { level: "success" | "attention" | "info"; title: string; href: string } {
    const out = isRecord(output) ? output : {};
    const docKind = DOC_WORKFLOWS[e.workflow];
    const task = this.taskOf(pd, e);
    if (docKind) {
      const label = KIND_LABEL[docKind];
      const doc = this.store.docOf(pd, docKind);
      return out.accepted
        ? { level: "success", title: `${label} accepted`, href: doc ? `/projects/${pd.project.id}/docs/${doc.id}` : `/runs/${e.runId}` }
        : { level: "attention", title: `${e.workflow} ended without an accepted ${label}`, href: `/runs/${e.runId}` };
    }
    if (e.workflow === "dev-plan")
      return out.approved
        ? { level: "success", title: `Plan approved: ${plural(Array.isArray(out.tasks) ? out.tasks.length : 0, "task")}`, href: `/projects/${pd.project.id}/implementation?step=execution` }
        : { level: "attention", title: "dev-plan ended without an approved plan", href: `/runs/${e.runId}` };
    if (e.workflow === "dev-task" && task) {
      const href = `/projects/${pd.project.id}/tasks/${task.id}`;
      if (out.approved) return { level: "success", title: `${taskLabel(task)} approved`, href };
      if (out.cancelled) return { level: "info", title: `${taskLabel(task)} cancelled`, href };
      return { level: "attention", title: `${taskLabel(task)} was not approved`, href };
    }
    return { level: "success", title: `${e.workflow} finished`, href: `/runs/${e.runId}` };
  }

  private async completeDocRun(pd: ProjectData, e: EngineEvent, kind: "brd" | "aad", out: DocWorkflowOutput<DraftReport>, at: number): Promise<void> {
    const stage: StageId = kind === "brd" ? "requirements" : "architecture";
    const doc = this.store.ensureDoc(pd, kind, typeof out.path === "string" ? out.path : pd.project.docPaths[kind]);
    const report = asReport(out.lastReport, doc.path);
    if (report) doc.lastReport = report;
    const why = whyByRef(this.depsDetail.get(e.runId));
    if (Array.isArray(out.dependencies))
      doc.dependencies = out.dependencies.map((d, i): Dependency => {
        const dep: Dependency = { id: d.id ?? `R${i + 1}`, ref: d.ref, kind: d.kind === "confluence" ? "confluence" : "jira", relation: d.relation ?? "other", title: d.title ?? d.ref };
        const w = why.get(d.ref);
        if (w) dep.why = w;
        return dep;
      });
    if (out.memory) doc.memory = out.memory;
    const label = kind.toUpperCase();
    if (out.accepted) {
      const by = human(this.answeredBy(e));
      doc.status = "accepted";
      doc.acceptedBy = by;
      doc.acceptedAt = at;
      const last = doc.versions.at(-1);
      const text = last ? await this.blobText(last.blob) : "";
      if (text) this.store.applyParse(doc, text);
      const mem = out.memory?.status;
      const memNote = mem === "updated" ? " · memory update applied" : mem === "discarded" ? " · memory update discarded" : mem === "unchanged" ? " · memory unchanged" : "";
      this.store.log(pd, stage, "artifact.accepted", by, `${label} v${doc.versions.length} accepted by ${by.kind === "human" ? by.name : "Demo user"} (round ${out.rounds ?? 1})${memNote}`, {
        runId: e.runId,
        href: `/projects/${pd.project.id}/docs/${doc.id}`,
      }, at);
      if (kind === "brd") this.store.proposeEpics(pd, doc, at);
      else {
        this.store.applyAadToEpics(pd, doc, at);
        delete pd.project.stages.architecture.epicUpdatesAcceptedAt;
      }
    } else {
      this.store.log(pd, stage, "run.completed", agent(e.workflow), `${label} not accepted after ${plural(out.rounds ?? 0, "round")}; memory left unchanged`, { runId: e.runId, href: `/runs/${e.runId}` }, at);
    }
    if (out.memory?.status === "updated") {
      const file = this.store.host.fs.read("memory/memory.md");
      if (file) {
        const mem = this.store.ensureDoc(pd, "memory", "memory/memory.md", "Shared memory");
        const blob = this.store.host.putBlob(file.content);
        this.store.addVersion(mem, { sha256: blob.$blob, blob: blob.$blob, at, source: "agent", runId: e.runId, reason: `Updated by the ${label} run` });
        mem.status = "accepted";
        mem.acceptedBy = human(this.memoryBy.get(e.runId) ?? this.answeredBy(e));
        mem.acceptedAt = at;
        mem.memory = out.memory;
      }
    }
    this.store.touch(pd, at);
  }

  private async completePlan(pd: ProjectData, e: EngineEvent, out: DevPlanOutput, at: number): Promise<void> {
    const impl = pd.project.stages.implementation;
    if (!out.approved) {
      this.store.log(pd, "implementation", "run.completed", agent("dev-plan"), `Plan not approved after ${plural(out.rounds ?? 0, "round")}`, { runId: e.runId, href: `/runs/${e.runId}` }, at);
      return;
    }
    const by = human(this.answeredBy(e));
    impl.planApprovedAt = at;
    impl.startMode = out.start ?? "all-waves";
    const plan = this.store.docOf(pd, "plan");
    if (plan) {
      plan.status = "accepted";
      plan.acceptedBy = by;
      plan.acceptedAt = at;
    }
    const tasks = Array.isArray(out.tasks) ? out.tasks : [];
    this.store.createTasks(pd, tasks, at);
    const waves = new Set(tasks.map((t) => t.wave)).size;
    this.store.log(pd, "implementation", "plan.approved", by, `${by.kind === "human" ? by.name : "Demo user"} approved plan: ${plural(tasks.length, "task")} in ${plural(waves, "wave")} · start ${impl.startMode}`, {
      runId: e.runId,
      href: `/projects/${pd.project.id}/implementation?step=execution`,
    }, at);
    await this.store.pump(pd, SYSTEM);
  }

  private async completeDevTask(pd: ProjectData, e: EngineEvent, out: DevTaskOutput, at: number): Promise<void> {
    const task = this.taskOf(pd, e);
    if (!task) return;
    if (Array.isArray(out.checks) && out.checks.length) task.checks = out.checks;
    if (out.diffStats) task.diffStats = out.diffStats;
    if (typeof out.reworkCycles === "number") task.reworkCount = out.reworkCycles;
    task.escalated = !!out.escalated;
    delete task.latestStep;
    task.finishedAt = at;
    const label = taskLabel(task);
    const input = this.store.inputs.get(e.runId) as Partial<DevTaskInput> | undefined;
    if (out.approved) {
      task.status = "done";
      const passed = task.checks.filter((c) => c.status === "pass").length;
      this.store.log(pd, this.stageOf(e), "task.status", agent("dev-task"), `${label} done · ${passed}/${task.checks.length} checks passed`, { runId: e.runId, taskId: task.id, href: `/projects/${pd.project.id}/tasks/${task.id}` }, at);
    } else if (out.cancelled) {
      task.status = "cancelled";
    } else {
      task.status = "blocked";
      task.blockedBy = `Not approved after ${plural(task.reworkCount, "rework cycle")}`;
    }
    if (pd.project.stages.implementation.approvedAt) this.store.refreshChangeReviews(pd, at);
    // QA loop-back: the developer approved the fix, so QA runs again automatically.
    if (out.approved && input?.origin === "qa" && !pd.project.stages.qa.approvedAt) {
      try {
        await this.store.startQaRun(pd, task, SYSTEM);
      } catch (err) {
        this.store.addNotice(pd.project.id, "qa", `Could not restart QA for ${label}: ${errorMessage(err)}`);
      }
    }
    await this.store.pump(pd, SYSTEM);
  }

  private async completeQa(pd: ProjectData, e: EngineEvent, out: QaVerifyOutput, at: number): Promise<void> {
    const task = this.taskOf(pd, e);
    if (!task) return;
    const label = taskLabel(task);
    task.qa.verdict = out.verdict;
    task.qa.bugs = asStringArray(out.bugs);
    task.qa.status = out.verdict === "ready-for-po-review" ? "certified" : out.verdict === "bugs-found" ? "bugs_found" : "blocked";
    delete task.latestStep;
    const verdict = out.verdict === "ready-for-po-review" ? "ready for PO review" : out.verdict === "bugs-found" ? `bugs found (${task.qa.bugs.length})` : "blocked";
    this.store.log(pd, "qa", "qa.verdict", agent("qa-verify"), `QA ${label}: ${verdict}`, { runId: e.runId, taskId: task.id, href: `/projects/${pd.project.id}/tasks/${task.id}` }, at);
    const href = `/projects/${pd.project.id}/tasks/${task.id}`;
    const body = `${pd.project.name}${out.comment ? `: ${shorten(out.comment, 120)}` : ""}`;
    if (out.verdict === "bugs-found") {
      // The criteria the bugs name are not met any more; with none named, every criterion waits
      // for the re-test to certify it again.
      const named = new Set(task.qa.bugs.flatMap((b) => [...b.matchAll(/\bAC-(\d+)\b/gi)].map((m) => `AC-${m[1]}`)));
      const hit = task.acceptanceCriteria.filter((ac) => named.has(ac.id));
      for (const ac of hit.length ? hit : task.acceptanceCriteria) ac.met = false;
      let started = false;
      if (!pd.project.stages.qa.approvedAt) {
        const feedback = task.qa.bugs.length ? task.qa.bugs.map((b) => `- ${b}`).join("\n") : out.comment || "QA found bugs";
        try {
          await this.store.startDevTask(pd, task, { origin: "qa", feedback, actor: SYSTEM });
          started = true;
        } catch (err) {
          this.store.addNotice(pd.project.id, "qa", `Could not start the loop-back for ${label}: ${errorMessage(err)}`);
        }
      }
      this.store.notify({ level: "attention", title: `QA found ${plural(task.qa.bugs.length || 1, "bug")} on ${label}${started ? "; rework started" : ""}`, body, href, projectId: pd.project.id });
    } else if (out.verdict === "blocked") {
      this.store.notify({ level: "attention", title: `${label} is blocked for QA`, body, href, projectId: pd.project.id });
    } else {
      this.store.notify({ level: "success", title: `${label} certified`, body, href, projectId: pd.project.id });
    }
  }

  private async onFailed(pd: ProjectData, e: EngineEvent, ev: Ev<"run.failed">): Promise<void> {
    const at = e.record.at;
    const message = ev.error?.message ?? "unknown error";
    this.store.failures.set(e.runId, message);
    const task = this.taskOf(pd, e);
    if (task && e.workflow === "dev-task") {
      task.status = "blocked";
      task.blockedBy = `dev-task run ${e.runId} failed: ${shorten(message, 80)}`;
      delete task.latestStep;
    }
    if (task && e.workflow === "qa-verify") {
      task.qa.status = "blocked";
      delete task.latestStep;
    }
    this.store.log(pd, this.stageOf(e), "run.failed", agent(e.workflow), `${e.workflow} run ${e.runId} failed: ${shorten(message, 120)}`, { runId: e.runId, href: `/runs/${e.runId}`, ...(task ? { taskId: task.id } : {}) }, at);
    this.store.notify({ level: "error", title: `${e.workflow} failed${task ? ` on ${taskLabel(task)}` : ""}`, body: `${pd.project.name} · run ${e.runId}: ${shorten(message, 120)}`, href: `/runs/${e.runId}`, projectId: pd.project.id });
    this.forget(e.runId);
    if (e.workflow === "dev-task") await this.store.pump(pd, SYSTEM);
  }

  private async onCancelled(pd: ProjectData, e: EngineEvent): Promise<void> {
    const at = e.record.at;
    const task = this.taskOf(pd, e);
    if (task && e.workflow === "dev-task" && task.status !== "cancelled" && task.status !== "done") {
      // Not "ready": the scheduler would restart a run someone just cancelled. Retry unblocks it.
      task.status = "blocked";
      task.blockedBy = `dev-task run ${e.runId} was cancelled; retry the task to run it again`;
      delete task.latestStep;
    }
    if (task && e.workflow === "qa-verify" && task.qa.status !== "certified") {
      task.qa.status = "pending";
      delete task.latestStep;
    }
    this.store.log(pd, this.stageOf(e), "run.completed", agent(e.workflow), `${e.workflow} run ${e.runId} was cancelled`, { runId: e.runId, href: `/runs/${e.runId}`, ...(task ? { taskId: task.id } : {}) }, at);
    this.forget(e.runId);
    if (e.workflow === "dev-task") await this.store.pump(pd, SYSTEM);
  }

  private forget(runId: string): void {
    this.steps.delete(runId);
    this.drafts.delete(runId);
    this.depsDetail.delete(runId);
    this.gates.delete(runId);
  }
}

export type { StoredDoc };
