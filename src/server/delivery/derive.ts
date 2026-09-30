import "server-only";
/**
 * Derived read models (SPEC 4.3): per-stage status, blockers, warnings, metric and sub-step;
 * project health; the next-step card; spend; ProjectSummary. Pure functions of the stored
 * project data plus a weft Snapshot, so every endpoint agrees on what a stage "is".
 */
import {
  STAGES,
  type DeliveryTask,
  type Health,
  type ProjectSummary,
  type StageBlocker,
  type StageId,
  type StageStatus,
  type StageView,
  type TraceRow,
} from "@/lib/delivery/types";
import type { PendingEntry, RunRow } from "@/lib/weft/types";
import { acceptedDoc, buildTrace } from "./trace";
import { boardLabel, isAgentActive, isInFlight, isOpenRun, isParked, isStartable, isTerminal, taskLabel } from "./rules";
import { reqKey, type ProjectData, type Snapshot } from "./state";
import { actorName, nextStageOf, plural, stageTitle } from "./util";

export interface ProjectView {
  stages: Record<StageId, StageView>;
  health: Health;
  /** Why health is not on track: the rule that fired. */
  healthReason?: string;
  nextStep?: { text: string; href: string; stage: StageId };
  spendUsd: number;
  trace: TraceRow[];
  /** Pending (non-policy) requests on this project's runs, oldest first. */
  pending: PendingEntry[];
}

/** A stage view before its runs are attached; blockers carry their links until deriveProject splits them. */
type Core = Omit<StageView, "id" | "runs" | "pending" | "blockers" | "blockerItems"> & { blockers: StageBlocker[] };

/** "T-2 (CP-52335), T-3 (CP-52336), …": board ids, as the task board shows them. */
const ids = (list: Array<Pick<DeliveryTask, "id" | "jiraKey">>, max = 4) => {
  const labels = list.map(boardLabel);
  return labels.length > max ? `${labels.slice(0, max).join(", ")}, …` : labels.join(", ");
};

const stageHref = (pd: ProjectData, stage: StageId, step?: string) => `/projects/${pd.project.id}/${stage}${step ? `?step=${step}` : ""}`;
const taskHref = (pd: ProjectData, t: Pick<DeliveryTask, "id">) => `/projects/${pd.project.id}/tasks/${t.id}`;

/** One task links to its page; several link to the stage step that lists them. */
function tasksHref(pd: ProjectData, list: DeliveryTask[], stage: StageId, step: string): string {
  return list.length === 1 ? taskHref(pd, list[0]) : stageHref(pd, stage, step);
}

/** What a pending request is, in words: "Developer review of the CP-52204 rework". */
function pendingSubject(pd: ProjectData, entry: PendingEntry, snap: Snapshot): string {
  const owner = snap.owners.get(entry.runId) ?? snap.owners.get(entry.rootRunId);
  const key = keyOf(entry, snap) ?? "";
  const n = key.split(":").at(-1);
  const task = owner?.taskId ? pd.tasks.find((t) => t.id === owner.taskId) : undefined;
  const doc = owner?.stage === "architecture" ? "AAD" : "BRD";
  if (key.startsWith("task:review:")) {
    if (!task) return "Developer review of a task";
    // A dev-task run owned by QA is the loop-back after QA reported bugs.
    return owner?.stage === "qa" ? `Developer review of the ${taskLabel(task)} rework` : `Developer review of ${boardLabel(task)}`;
  }
  if (key.startsWith("qa:review:")) return task ? `QA review of ${taskLabel(task)}` : "QA review of a task";
  if (key.startsWith("plan:review:")) return `Developer review of the implementation plan (round ${n})`;
  if (key.startsWith("deps:review:")) return `Dependency review for the ${doc} (pass ${n})`;
  if (key.startsWith("memory:review")) return `Memory update review for the ${doc}`;
  if (key.startsWith("review:")) return `${doc} draft review (round ${n})`;
  return `${entry.workflow} request ${entry.id}${task ? ` on ${taskLabel(task)}` : ""}`;
}

/** "1 pending request: Developer review of the CP-52204 rework is waiting", linked to the oldest request. */
function pendingBlocker(pd: ProjectData, pending: PendingEntry[], snap: Snapshot): StageBlocker {
  const shown = pending.slice(0, 2).map((e) => `${pendingSubject(pd, e, snap)} is waiting`);
  const more = pending.length > shown.length ? `; +${pending.length - shown.length} more` : "";
  return { text: `${plural(pending.length, "pending request")}: ${shown.join("; ")}${more}`, href: humanHref(pd.project.id, pending[0], snap) };
}

function runsOf(runIds: string[], snap: Snapshot): RunRow[] {
  return runIds.map((id) => snap.runs.get(id)).filter((r): r is RunRow => !!r);
}

export function pendingOf(runIds: string[], snap: Snapshot): PendingEntry[] {
  const set = new Set(runIds);
  return snap.pending.filter((p) => p.kind !== "gate" && (set.has(p.runId) || set.has(p.rootRunId)));
}

function keyOf(entry: PendingEntry, snap: Snapshot): string | undefined {
  return snap.requests.get(reqKey(entry.runId, entry.id))?.key;
}

function docStep(pending: PendingEntry[], latest: RunRow | undefined, accepted: boolean, snap: Snapshot, first: string): string {
  const key = pending.length ? keyOf(pending[0], snap) ?? "" : "";
  if (key.startsWith("deps:review")) return "discovery";
  if (key.startsWith("memory:review")) return "memory";
  if (key.startsWith("review:")) return "drafts";
  if (latest && isOpenRun(latest.status)) {
    const phase = snap.phases.get(latest.runId) ?? "";
    if (/^update memory/i.test(phase)) return "memory";
    if (/^draft/i.test(phase)) return "drafts";
    return "discovery";
  }
  if (accepted) return "epics";
  return latest ? "drafts" : first;
}

function requirementsCore(pd: ProjectData, snap: Snapshot, pending: PendingEntry[]): Core {
  const st = pd.project.stages.requirements;
  const latest = runsOf(st.runIds, snap).at(-1);
  const brd = acceptedDoc(pd, "brd");
  const accepted = brd?.status === "accepted";
  const open = pd.epics.filter((e) => !isParked(e));
  const drafts = open.filter((e) => e.status === "draft");
  const parked = pd.epics.filter(isParked);
  const step = docStep(pending, latest, accepted, snap, "intake");
  const blockers: StageBlocker[] = [];
  if (!accepted) blockers.push({ text: "The BRD is not accepted yet", href: stageHref(pd, "requirements", step) });
  if (accepted && !open.length) blockers.push({ text: "No epics yet: add at least one", href: stageHref(pd, "requirements", "epics") });
  if (drafts.length) blockers.push({ text: `${plural(drafts.length, "epic")} not accepted yet`, href: stageHref(pd, "requirements", "epics") });
  if (pending.length) blockers.push(pendingBlocker(pd, pending, snap));
  const warnings: string[] = [];
  if (accepted && brd) {
    if (brd.openQuestions?.length) warnings.push(`${plural(brd.openQuestions.length, "open question")} in the BRD`);
    const bq = brd.lastReport?.blockingQuestions.length ?? 0;
    if (bq) warnings.push(`${plural(bq, "blocking question")} in the last draft report`);
    if (brd.memory?.status === "discarded") warnings.push("The memory update from the BRD was discarded");
  }
  if (parked.length) warnings.push(`${plural(parked.length, "epic")} blocked by open questions ${parked.length === 1 ? "stays" : "stay"} draft: ${parked.map((e) => `${e.title} (${e.blockedBy?.join(", ")})`).join("; ")}`);

  let status: StageStatus;
  if (st.approvedAt) status = "approved";
  else if (pending.length) status = "needs_input";
  else if (latest && isAgentActive(latest.status)) status = "in_progress";
  else if (!accepted) {
    if (latest?.status === "failed" || latest?.status === "cancelled") status = "failed";
    else if (latest?.status === "complete") status = "needs_input";
    else if (!latest && !st.imported) status = "not_started";
    else status = "in_progress";
  } else status = blockers.length ? "needs_input" : "in_review";

  const metric = brd ? `BRD v${brd.versions.length} ${accepted ? "accepted" : "draft"}${pd.epics.length ? ` · ${plural(pd.epics.length, "epic")}` : ""}` : undefined;
  return { status, blockers, warnings, metric, step };
}

function architectureCore(pd: ProjectData, snap: Snapshot, pending: PendingEntry[]): Core {
  const st = pd.project.stages.architecture;
  const latest = runsOf(st.runIds, snap).at(-1);
  const aad = acceptedDoc(pd, "aad");
  const accepted = aad?.status === "accepted";
  const drafts = pd.epics.filter((e) => e.status === "draft" && !isParked(e));
  const step = docStep(pending, latest, accepted, snap, "brief");
  const blockers: StageBlocker[] = [];
  if (!accepted) blockers.push({ text: "The AAD is not accepted yet", href: stageHref(pd, "architecture", step) });
  if (accepted && !st.epicUpdatesAcceptedAt) blockers.push({ text: "Epic updates from the AAD are not accepted yet", href: stageHref(pd, "architecture", "epics") });
  else if (drafts.length) blockers.push({ text: `${plural(drafts.length, "epic")} not accepted yet`, href: stageHref(pd, "architecture", "epics") });
  if (pending.length) blockers.push(pendingBlocker(pd, pending, snap));
  const warnings: string[] = [];
  const report = aad?.lastReport as { decisionsNeeded?: string[]; untracedRequirements?: string[]; blockingQuestions?: string[] } | undefined;
  if (accepted && report) {
    if (report.blockingQuestions?.length) warnings.push(`${plural(report.blockingQuestions.length, "blocking question")} in the AAD draft report`);
    if (report.decisionsNeeded?.length) warnings.push(`${plural(report.decisionsNeeded.length, "decision")} needed in the AAD`);
    if (report.untracedRequirements?.length) warnings.push(`${plural(report.untracedRequirements.length, "BRD requirement")} not traced in the AAD`);
  }
  if (accepted && aad?.memory?.status === "discarded") warnings.push("The memory update from the AAD was discarded");

  let status: StageStatus;
  const locked = !pd.project.stages.requirements.approvedAt;
  if (locked) status = "locked";
  else if (st.approvedAt) status = "approved";
  else if (pending.length) status = "needs_input";
  else if (latest && isAgentActive(latest.status)) status = "in_progress";
  else if (!accepted) {
    if (latest?.status === "failed" || latest?.status === "cancelled") status = "failed";
    else if (latest?.status === "complete") status = "needs_input";
    // Requirements is approved and nothing ran yet: starting the architecture run is due.
    else if (!latest && !st.imported) status = "needs_input";
    else status = "in_progress";
  } else status = blockers.length ? "needs_input" : "in_review";

  const metric = aad ? `AAD v${aad.versions.length} ${accepted ? "accepted" : "draft"}${aad.frs?.length ? ` · ${aad.frs.length} FRs` : ""}` : undefined;
  return {
    status,
    blockers: locked ? [{ text: "Requirements is not approved", href: stageHref(pd, "requirements") }] : blockers,
    warnings: locked ? [] : warnings,
    metric,
    step,
  };
}

function implementationCore(pd: ProjectData, snap: Snapshot, pending: PendingEntry[]): Core {
  const st = pd.project.stages.implementation;
  const latestPlan = runsOf(st.planRunIds, snap).at(-1);
  const tasks = pd.tasks.filter((t) => t.status !== "cancelled");
  const done = tasks.filter((t) => t.status === "done");
  const notDone = tasks.filter((t) => t.status !== "done");
  const blockers: StageBlocker[] = [];
  if (!st.planApprovedAt) blockers.push({ text: "The implementation plan is not approved yet", href: stageHref(pd, "implementation", "plan") });
  else if (!tasks.length) blockers.push({ text: "The plan has no tasks", href: stageHref(pd, "implementation", "plan") });
  if (notDone.length) blockers.push({ text: `${notDone.length} of ${plural(tasks.length, "task")} not done: ${ids(notDone)}`, href: tasksHref(pd, notDone, "implementation", "execution") });
  if (pending.length) blockers.push(pendingBlocker(pd, pending, snap));
  const warnings: string[] = [];
  const escalated = tasks.filter((t) => t.escalated);
  if (escalated.length) warnings.push(`${plural(escalated.length, "escalated task")}: ${ids(escalated)}`);
  const failing = done.filter((t) => t.checks.some((c) => c.status === "fail"));
  if (failing.length) warnings.push(`${plural(failing.length, "task")} approved with failing checks: ${ids(failing)}`);

  const planPending = latestPlan ? pendingOf([latestPlan.runId], snap) : [];
  let status: StageStatus;
  const locked = !pd.project.stages.architecture.approvedAt;
  if (locked) status = "locked";
  else if (st.approvedAt) status = "approved";
  else if (pending.length) status = "needs_input";
  else if (!st.planApprovedAt) {
    if (latestPlan && isAgentActive(latestPlan.status)) status = "in_progress";
    else if (latestPlan?.status === "failed" || latestPlan?.status === "cancelled") status = "failed";
    else if (latestPlan?.status === "complete") status = "needs_input";
    // Architecture is approved and no plan was generated yet: generating it is due.
    else if (!latestPlan) status = "needs_input";
    else status = "in_progress";
  } else if (!blockers.length) status = "in_review";
  else if (tasks.some(isInFlight) || pd.queue.length) status = "in_progress";
  else if (tasks.some((t) => isStartable(t, pd.tasks)) || tasks.some((t) => t.status === "blocked")) status = "needs_input";
  else status = "in_progress";

  let step: string;
  if (!st.planRunIds.length) step = "notes";
  else if (planPending.length) step = "plan_review";
  else if (!st.planApprovedAt) step = latestPlan && isOpenRun(latestPlan.status) ? "planning" : "notes";
  else step = notDone.length ? "executing" : "complete";

  const metric = tasks.length ? `${done.length}/${tasks.length} tasks approved` : latestPlan ? (st.planApprovedAt ? "No tasks" : "Planning") : undefined;
  return { status, blockers: locked ? [{ text: "Architecture is not approved", href: stageHref(pd, "architecture") }] : blockers, warnings: locked ? [] : warnings, metric, step };
}

function qaCore(pd: ProjectData, snap: Snapshot, pending: PendingEntry[], trace: TraceRow[]): Core {
  const st = pd.project.stages.qa;
  const runs = runsOf(st.runIds, snap);
  const tasks = pd.tasks.filter((t) => t.status !== "cancelled");
  const certified = tasks.filter((t) => t.qa.status === "certified");
  const notCertified = tasks.filter((t) => t.qa.status !== "certified");
  const unmet = trace.filter((r) => r.verdict !== "met" && r.verdict !== "waived");
  const unreviewed = pd.changeReviews.filter((c) => c.consistent === undefined);
  const blockers: StageBlocker[] = [];
  if (!tasks.length) blockers.push({ text: "No tasks to certify", href: stageHref(pd, "qa", "tasks") });
  if (notCertified.length) blockers.push({ text: `${notCertified.length} of ${plural(tasks.length, "task")} not certified: ${ids(notCertified)}`, href: tasksHref(pd, notCertified, "qa", "tasks") });
  if (unmet.length) blockers.push({ text: `${plural(unmet.length, "requirement")} not met or waived: ${unmet.map((r) => r.brRef).join(", ")}`, href: stageHref(pd, "qa", "traceability") });
  if (unreviewed.length) blockers.push({ text: `${plural(unreviewed.length, "change review")} pending`, href: stageHref(pd, "qa", "changes") });
  if (pending.length) blockers.push(pendingBlocker(pd, pending, snap));
  const warnings: string[] = [];
  const inconclusive = pd.evidence.filter((e) => !e.supersededBy && e.result === "inconclusive");
  if (inconclusive.length) warnings.push(`${plural(inconclusive.length, "inconclusive evidence item")}`);
  const inconsistent = pd.changeReviews.filter((c) => c.consistent === false);
  if (inconsistent.length) warnings.push(`${plural(inconsistent.length, "change")} marked inconsistent with the requirements`);

  const lastQaFailed = tasks.some((t) => {
    const last = t.qa.runIds.at(-1);
    return last ? snap.runs.get(last)?.status === "failed" : false;
  });
  let status: StageStatus;
  const locked = !pd.project.stages.implementation.approvedAt;
  if (locked) status = "locked";
  else if (st.approvedAt) status = "approved";
  else if (pending.length) status = "needs_input";
  else if (runs.some((r) => isAgentActive(r.status))) status = "in_progress";
  // Implementation is approved and QA has not run yet: running QA is due.
  else if (!runs.length) status = "needs_input";
  else if (lastQaFailed) status = "failed";
  else status = blockers.length ? "needs_input" : "in_review";

  let step: string;
  if (notCertified.length || !tasks.length) step = "tasks";
  else if (unmet.length) step = "traceability";
  else if (unreviewed.length) step = "changes";
  else step = "final";
  const metric = tasks.length ? `${certified.length}/${tasks.length} tasks certified` : undefined;
  return { status, blockers: locked ? [{ text: "Implementation is not approved", href: stageHref(pd, "implementation") }] : blockers, warnings: locked ? [] : warnings, metric, step };
}

function signoffCore(pd: ProjectData): Core {
  const st = pd.project.stages.signoff;
  const locked = !pd.project.stages.qa.approvedAt;
  const lastApproval = [...st.decisions].reverse().find((d) => d.decision === "approved");
  return {
    status: locked ? "locked" : st.approvedAt ? "approved" : "in_review",
    blockers: locked ? [{ text: "QA Certification is not approved", href: stageHref(pd, "qa") }] : [],
    warnings: [],
    metric: st.approvedAt ? `Signed off${lastApproval ? ` by ${actorName(lastApproval.by)}` : ""}` : locked ? undefined : "Ready for sign-off",
    step: "summary",
  };
}

/** Failed runs with no newer successful run of the same workflow (and task). */
export function unresolvedFailures(pd: ProjectData, snap: Snapshot): RunRow[] {
  const all = STAGES.flatMap((s) => runsOf(pd.project.stages[s.id].runIds, snap));
  const unique = [...new Map(all.map((r) => [r.runId, r])).values()];
  const group = (r: RunRow) => `${r.workflow}:${snap.owners.get(r.runId)?.taskId ?? ""}`;
  return unique.filter(
    (r) => r.status === "failed" && !unique.some((o) => group(o) === group(r) && o.createdAt > r.createdAt && o.status === "complete"),
  );
}

export function projectRunIds(pd: ProjectData): string[] {
  return [...new Set(STAGES.flatMap((s) => pd.project.stages[s.id].runIds))];
}

const WAIT_LIMIT_MS = 24 * 3600_000;

/** "a; b" or "a; b; +2 more". */
function reasons(list: string[]): string {
  return list.length > 2 ? `${list.slice(0, 2).join("; ")}; +${list.length - 2} more` : list.join("; ");
}

/** SPEC 4.3 health, with the reason from the rule that fired. */
function health(pd: ProjectData, snap: Snapshot, pending: PendingEntry[]): { health: Health; reason?: string } {
  if (pd.project.done) return { health: "on_track" };
  const off = [
    ...unresolvedFailures(pd, snap).map((r) => {
      const task = pd.tasks.find((t) => t.id === snap.owners.get(r.runId)?.taskId);
      return `${r.workflow} run ${r.runId} failed${task ? ` (${boardLabel(task)})` : ""}`;
    }),
    ...pd.tasks.filter((t) => t.escalated && t.status !== "done" && t.status !== "cancelled").map((t) => `${boardLabel(t)} escalated`),
  ];
  if (off.length) return { health: "off_track", reason: reasons(off) };
  const risk: string[] = [];
  for (const kind of ["brd", "aad"] as const) {
    const d = acceptedDoc(pd, kind);
    const bq = d?.status === "accepted" ? (d.lastReport?.blockingQuestions.length ?? 0) : 0;
    if (bq) risk.push(`${plural(bq, "blocking question")} in the accepted ${kind.toUpperCase()}`);
  }
  const oldest = pending.filter((p) => snap.now - p.createdAt > WAIT_LIMIT_MS).sort((a, b) => a.createdAt - b.createdAt)[0];
  if (oldest) risk.push(`A request has waited ${Math.floor((snap.now - oldest.createdAt) / 3600_000)} h`);
  return risk.length ? { health: "at_risk", reason: reasons(risk) } : { health: "on_track" };
}

export function humanHref(projectId: string, entry: { runId: string; id: string }, snap: Pick<Snapshot, "owners">): string {
  const owner = snap.owners.get(entry.runId);
  const req = `?request=${entry.runId}:${entry.id}`;
  if (owner?.taskId && (owner.workflow === "dev-task" || owner.workflow === "qa-verify")) return `/projects/${projectId}/tasks/${owner.taskId}${req}`;
  return `/projects/${projectId}/${owner?.stage ?? "requirements"}${req}`;
}

function pendingText(pd: ProjectData, entry: PendingEntry, snap: Snapshot): string {
  const owner = snap.owners.get(entry.runId);
  const stage = owner?.stage ?? pd.project.currentStage;
  const role = STAGES.find((s) => s.id === stage)?.owner ?? "Owner";
  const key = keyOf(entry, snap) ?? "";
  const doc = stage === "architecture" ? "AAD" : "BRD";
  const n = key.split(":").at(-1);
  const task = owner?.taskId ? pd.tasks.find((t) => t.id === owner.taskId) : undefined;
  if (key.startsWith("deps:review:")) return `${role}: confirm the dependencies found for the ${doc} (pass ${n})`;
  if (key.startsWith("memory:review")) return `${role}: review the memory update from the ${doc}`;
  if (key.startsWith("review:")) {
    const d = acceptedDoc(pd, stage === "architecture" ? "aad" : "brd");
    const bq = d?.lastReport?.blockingQuestions.length ?? 0;
    return `${role}: ${doc} round ${n} is waiting — ${plural(bq, "blocking question")}`;
  }
  if (key.startsWith("plan:review:")) return `Developer: review the implementation plan (round ${n})`;
  if (key.startsWith("task:review:")) return `Developer: review ${task ? `${taskLabel(task)} · ${task.title}` : "a task"}`;
  if (key.startsWith("qa:review:")) return `QA: review ${task ? `${taskLabel(task)} · ${task.title}` : "a task"}`;
  return `${role}: ${entry.workflow} needs your input`;
}

function nextStep(pd: ProjectData, stages: Record<StageId, StageView>, pending: PendingEntry[], snap: Snapshot): ProjectView["nextStep"] {
  const p = pd.project;
  const base = `/projects/${p.id}`;
  if (p.done) {
    const d = [...p.stages.signoff.decisions].reverse().find((x) => x.decision === "approved");
    return { text: `Done · signed off${d ? ` by ${actorName(d.by)}` : ""}`, href: base, stage: "signoff" };
  }
  const stage = p.currentStage;
  const def = STAGES.find((s) => s.id === stage)!;
  const role = def.owner;
  const view = stages[stage];
  const href = `${base}/${stage}`;
  const here = pending.filter((e) => snap.owners.get(e.runId)?.stage === stage);
  const first = here[0] ?? pending[0];
  if (first) return { text: pendingText(pd, first, snap), href: humanHref(p.id, first, snap), stage: snap.owners.get(first.runId)?.stage ?? stage };
  const next = nextStageOf(stage);
  const st = p.stages[stage];
  // An owner action that starts the stage is due (SPEC 4.3: needs_input with no run yet).
  if (view.status === "needs_input" || view.status === "not_started") {
    if (stage === "architecture" && !st.runIds.length && !p.stages.architecture.imported && acceptedDoc(pd, "aad")?.status !== "accepted")
      return { text: `${role}: start the architecture run`, href: `${href}?step=brief`, stage };
    if (stage === "implementation" && !p.stages.implementation.planRunIds.length && !p.stages.implementation.planApprovedAt)
      return { text: "Developer: generate the implementation plan", href: `${href}?step=plan`, stage };
  }
  switch (view.status) {
    case "not_started": {
      const text =
        stage === "requirements"
          ? `${role}: start the requirements run`
          : stage === "architecture"
            ? `${role}: start the architecture run`
            : stage === "implementation"
              ? "Developer: generate the implementation plan"
              : "QA: run the QA agents";
      return { text, href, stage };
    }
    case "in_progress": {
      const run = view.runs.filter((r) => isOpenRun(r.status)).at(-1);
      const phase = run ? snap.phases.get(run.runId) : undefined;
      if (stage === "implementation" && p.stages.implementation.planApprovedAt) {
        const active = pd.tasks.filter(isInFlight).length;
        return { text: `Developer: agents are working on ${plural(active, "task")}`, href, stage };
      }
      return { text: `${role}: ${run?.workflow ?? def.workflows[0] ?? "the agent"} is running${phase ? ` (${phase})` : ""}`, href, stage };
    }
    case "needs_input": {
      const draftEpics = pd.epics.filter((e) => e.status === "draft" && !isParked(e)).length;
      if ((stage === "requirements" || stage === "architecture") && view.runs.at(-1)?.status === "complete" && view.blockers.some((b) => /not accepted yet$/.test(b) && /^The (BRD|AAD)/.test(b)))
        return { text: `${role}: the last ${def.workflows[0]} run ended without acceptance — start another run`, href, stage };
      if (stage === "architecture" && view.blockers.some((b) => b.startsWith("Epic updates")))
        return { text: "Architect: accept the epic updates from the AAD", href: `${href}?step=epics`, stage };
      if ((stage === "requirements" || stage === "architecture") && draftEpics)
        return { text: `${role}: accept ${plural(draftEpics, "proposed epic")}`, href: `${href}?step=epics`, stage };
      if (stage === "requirements" && view.blockers.some((b) => b.startsWith("No epics"))) return { text: `${role}: add at least one epic`, href: `${href}?step=epics`, stage };
      if (stage === "implementation") {
        if (!p.stages.implementation.planApprovedAt) return { text: "Developer: the last plan was not approved — generate it again", href, stage };
        const startable = pd.tasks.filter((t) => isStartable(t, pd.tasks));
        if (startable.length) return { text: `Developer: start ${plural(startable.length, "ready task")}`, href: `${href}?step=execution`, stage };
        const blocked = pd.tasks.filter((t) => t.status === "blocked");
        if (blocked.length) return { text: `Developer: unblock ${ids(blocked)}${blocked[0].blockedBy ? ` (${blocked[0].blockedBy})` : ""}`, href: `${href}?step=execution`, stage };
      }
      if (stage === "qa") {
        const untested = pd.tasks.filter((t) => t.status === "done" && (t.qa.status === "pending" || t.qa.status === "blocked"));
        if (untested.length) return { text: `QA: run QA for ${plural(untested.length, "task")}`, href, stage };
        const unmet = view.blockers.find((b) => b.includes("not met or waived"));
        if (unmet) return { text: `QA: resolve requirements without evidence (${unmet.split(": ")[1]})`, href: `${href}?step=traceability`, stage };
        const reviews = pd.changeReviews.filter((c) => c.consistent === undefined).length;
        if (reviews) return { text: `QA: review ${plural(reviews, "code and memory change")}`, href: `${href}?step=changes`, stage };
      }
      return { text: `${role}: ${view.blockers[0] ?? "action needed"}`, href, stage };
    }
    case "in_review":
      if (stage === "signoff") return { text: "Product Owner: sign off the project", href, stage };
      return { text: `${role}: approve ${def.title} and move to ${next ? stageTitle(next) : "the next stage"}`, href, stage };
    case "failed":
      return { text: `${role}: the ${view.runs.at(-1)?.workflow ?? "last"} run failed — start it again`, href, stage };
    case "locked":
      return { text: `${role}: ${view.blockers[0] ?? "waiting on the previous stage"}`, href, stage };
    default:
      return undefined;
  }
}

export function spendOf(pd: ProjectData, snap: Snapshot): number {
  return projectRunIds(pd).reduce((sum, id) => sum + (snap.runs.get(id)?.spend?.usd ?? 0), 0);
}

export function deriveProject(pd: ProjectData, snap: Snapshot): ProjectView {
  const p = pd.project;
  const trace = buildTrace(pd);
  const stages = {} as Record<StageId, StageView>;
  const allPending: PendingEntry[] = [];
  for (const def of STAGES) {
    const st = p.stages[def.id];
    const pending = pendingOf(st.runIds, snap);
    allPending.push(...pending);
    const core =
      def.id === "requirements"
        ? requirementsCore(pd, snap, pending)
        : def.id === "architecture"
          ? architectureCore(pd, snap, pending)
          : def.id === "implementation"
            ? implementationCore(pd, snap, pending)
            : def.id === "qa"
              ? qaCore(pd, snap, pending, trace)
              : signoffCore(pd);
    // An approved stage has no gate left to block; later changes (e.g. a QA loop-back) show up
    // on the stage that owns them.
    const blockerItems = core.status === "approved" ? [] : core.blockers;
    stages[def.id] = {
      id: def.id,
      ...core,
      blockers: blockerItems.map((b) => b.text),
      blockerItems,
      runs: runsOf(st.runIds, snap).map((r) => {
        const taskId = snap.owners.get(r.runId)?.taskId;
        return taskId
          ? { runId: r.runId, workflow: r.workflow, status: r.status, createdAt: r.createdAt, taskId }
          : { runId: r.runId, workflow: r.workflow, status: r.status, createdAt: r.createdAt };
      }),
      pending: pending.length,
    };
  }
  // Keep the stored sub-step fields in sync for clients that read the project record directly.
  p.stages.implementation.step = stages.implementation.step as typeof p.stages.implementation.step;
  p.stages.qa.step = stages.qa.step as typeof p.stages.qa.step;
  const pending = [...new Map(allPending.map((e) => [reqKey(e.runId, e.id), e])).values()].sort((a, b) => a.createdAt - b.createdAt);
  const h = health(pd, snap, pending);
  return {
    stages,
    health: h.health,
    ...(h.reason ? { healthReason: h.reason } : {}),
    nextStep: nextStep(pd, stages, pending, snap),
    spendUsd: Math.round(spendOf(pd, snap) * 100) / 100,
    trace,
    pending,
  };
}

export function summaryOf(pd: ProjectData, view: ProjectView, waitingCount: number): ProjectSummary {
  const p = pd.project;
  const stageStatuses = Object.fromEntries(STAGES.map((s) => [s.id, view.stages[s.id].status])) as Record<StageId, StageStatus>;
  const summary: ProjectSummary = {
    id: p.id,
    key: p.key,
    name: p.name,
    summary: p.summary,
    currentStage: p.currentStage,
    stageStatuses,
    waitingCount,
    health: view.health,
    ...(view.healthReason ? { healthReason: view.healthReason } : {}),
    done: p.done,
    updatedAt: p.updatedAt,
    spendUsd: view.spendUsd,
  };
  if (view.nextStep) summary.nextStep = view.nextStep.text;
  return summary;
}

export { isTerminal };
