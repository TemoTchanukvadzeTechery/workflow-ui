import "server-only";
/**
 * The tiered inbox across projects: weft human requests (blocking a run), stage gates, epic
 * acceptance and due owner actions (awaiting approval), failed runs, escalations and system
 * notices (FYI). Sorted by tier, then oldest first.
 */
import { STAGES, type Activity, type InboxItem, type StageId } from "@/lib/delivery/types";
import { humanHref, unresolvedFailures, type ProjectView } from "./derive";
import { isParked, isStartable, taskLabel } from "./rules";
import { reqKey, type ProjectData, type Snapshot } from "./state";
import { nextStageOf, plural, stageTitle } from "./util";

const TIER_ORDER: Record<InboxItem["tier"], number> = { blocking_run: 0, awaiting_approval: 1, fyi: 2 };

function sinceOf(item: InboxItem): number {
  return item.kind === "human" ? item.entry.createdAt : item.since;
}

/** Latest activity time in a stage, used as "since" for gate/action items. */
function stageSince(pd: ProjectData, stage: StageId, activity: Activity[]): number {
  let at = 0;
  for (const a of activity) if (a.projectId === pd.project.id && a.stage === stage && a.at > at) at = a.at;
  return at || pd.project.updatedAt;
}

/**
 * `global` includes system notices of projects that no longer exist (e.g. a seed that failed
 * before creating its project); a project's own inbox only includes its notices.
 */
export function buildInbox(entries: Array<{ pd: ProjectData; view: ProjectView }>, snap: Snapshot, activity: Activity[], global = true): InboxItem[] {
  const items: InboxItem[] = [];
  for (const { pd, view } of entries) {
    const p = pd.project;
    const base = { projectId: p.id, projectName: p.name };

    for (const entry of view.pending) {
      const owner = snap.owners.get(entry.runId) ?? snap.owners.get(entry.rootRunId);
      const info = snap.requests.get(reqKey(entry.runId, entry.id));
      const item: Extract<InboxItem, { kind: "human" }> = {
        kind: "human",
        tier: "blocking_run",
        id: `human:${entry.runId}:${entry.id}`,
        ...base,
        stage: owner?.stage ?? p.currentStage,
        entry,
        waitingMs: Math.max(0, snap.now - entry.createdAt),
        href: humanHref(p.id, entry, snap),
      };
      if (info?.key) item.key = info.key;
      if (info?.phase) item.phase = info.phase;
      if (owner?.taskId) item.taskId = owner.taskId;
      items.push(item);
    }

    if (p.done) continue;

    for (const def of STAGES) {
      const sv = view.stages[def.id];
      if (sv.status !== "in_review") continue;
      const next = nextStageOf(def.id);
      items.push({
        kind: "stage-gate",
        tier: "awaiting_approval",
        id: `gate:${p.id}:${def.id}`,
        ...base,
        stage: def.id,
        title: def.id === "signoff" ? "Sign off and mark the project done" : `Approve ${def.title} and move to ${next ? stageTitle(next) : "the next stage"}`,
        blockers: sv.blockers,
        warnings: sv.warnings,
        href: `/projects/${p.id}/${def.id}`,
        since: stageSince(pd, def.id, activity),
      });
    }

    const reqs = p.stages.requirements;
    const arch = p.stages.architecture;
    const impl = p.stages.implementation;
    const brd = pd.documents.find((d) => d.id === reqs.brdDocId);
    const aad = pd.documents.find((d) => d.id === arch.aadDocId);
    const drafts = pd.epics.filter((e) => e.status === "draft" && !isParked(e));

    if (!reqs.approvedAt && brd?.status === "accepted" && drafts.length)
      items.push({ kind: "epics", tier: "awaiting_approval", id: `epics:${p.id}:requirements`, ...base, stage: "requirements", count: drafts.length, href: `/projects/${p.id}/requirements?step=epics`, since: stageSince(pd, "requirements", activity) });
    if (reqs.approvedAt && !arch.approvedAt && aad?.status === "accepted" && !arch.epicUpdatesAcceptedAt) {
      // The Stage 2 Epics step's count: epics the AAD changed or added (parked drafts stay out).
      const changed = pd.epics.filter((e) => e.changedIn === "architecture" || e.origin === "architecture").length;
      const count = changed || pd.epics.filter((e) => !isParked(e)).length;
      items.push({ kind: "epics", tier: "awaiting_approval", id: `epics:${p.id}:architecture`, ...base, stage: "architecture", count, href: `/projects/${p.id}/architecture?step=epics`, since: stageSince(pd, "architecture", activity) });
    }

    const action = (stage: StageId, slug: string, title: string, href = `/projects/${p.id}/${stage}`) =>
      items.push({ kind: "action", tier: "awaiting_approval", id: `action:${p.id}:${slug}`, ...base, stage, title, href, since: stageSince(pd, stage, activity) });

    const sv = view.stages;
    if (sv.requirements.status === "not_started") action("requirements", "start-requirements", "Start the requirements run");
    if (sv.requirements.status === "needs_input" && !view.pending.length && brd?.status !== "accepted" && sv.requirements.runs.at(-1)?.status === "complete")
      action("requirements", "rerun-requirements", "The BRD was not accepted: start another requirements run");
    if (!reqs.approvedAt && brd?.status === "accepted" && !drafts.length) {
      const unsynced = pd.epics.filter((e) => e.status === "accepted" && !e.key).length;
      if (unsynced) action("requirements", "sync-epics", `Create ${plural(unsynced, "epic")} in Jira (mock)`, `/projects/${p.id}/requirements?step=epics`);
    }
    // Requirements approved and nothing ran or was imported yet: the architecture run is due.
    if (reqs.approvedAt && !arch.approvedAt && !arch.runIds.length && !arch.imported && aad?.status !== "accepted" && sv.architecture.status === "needs_input")
      action("architecture", "start-architecture", "Start the architecture run", `/projects/${p.id}/architecture?step=brief`);
    if (sv.architecture.status === "needs_input" && aad?.status !== "accepted" && sv.architecture.runs.at(-1)?.status === "complete" && !sv.architecture.pending)
      action("architecture", "rerun-architecture", "The AAD was not accepted: start another architecture run");
    if (arch.approvedAt && !impl.approvedAt && !impl.planRunIds.length && !impl.planApprovedAt && sv.implementation.status === "needs_input")
      action("implementation", "generate-plan", "Generate the implementation plan", `/projects/${p.id}/implementation?step=plan`);
    if (impl.planApprovedAt && !impl.approvedAt) {
      const startable = pd.tasks.filter((t) => isStartable(t, pd.tasks) && !pd.queue.includes(t.id));
      if (startable.length) action("implementation", "start-tasks", `Start ${plural(startable.length, "ready task")}`, `/projects/${p.id}/implementation?step=execution`);
    }
    if (impl.approvedAt && !p.stages.qa.approvedAt) {
      const untested = pd.tasks.filter((t) => t.status === "done" && t.qa.status === "pending" && !t.qa.runIds.length);
      if (untested.length) action("qa", "run-qa", `Run QA for ${plural(untested.length, "task")}`);
      const allCertified = pd.tasks.every((t) => t.status === "cancelled" || t.qa.status === "certified");
      if (allCertified) {
        const reviews = pd.changeReviews.filter((c) => c.consistent === undefined).length;
        if (reviews) action("qa", "review-changes", `Review ${plural(reviews, "code and memory change")}`, `/projects/${p.id}/qa?step=changes`);
        const unmet = view.trace.filter((r) => r.verdict !== "met" && r.verdict !== "waived");
        if (unmet.length) action("qa", "trace", `Resolve ${plural(unmet.length, "requirement")} without evidence: ${unmet.map((r) => r.brRef).join(", ")}`, `/projects/${p.id}/qa?step=traceability`);
      }
    }

    for (const run of unresolvedFailures(pd, snap)) {
      const owner = snap.owners.get(run.runId);
      const reason = snap.failures.get(run.runId);
      items.push({
        kind: "notice",
        tier: "fyi",
        id: `notice:${p.id}:${run.runId}`,
        ...base,
        stage: owner?.stage ?? p.currentStage,
        text: `${run.workflow} run ${run.runId} failed${reason ? `: ${reason}` : ""}`,
        href: `/runs/${run.runId}`,
        since: run.updatedAt,
        level: "error",
      });
    }
    for (const t of pd.tasks) {
      const href = `/projects/${p.id}/tasks/${t.id}`;
      const since = t.finishedAt ?? t.startedAt ?? p.updatedAt;
      if (t.escalated && t.status !== "done" && t.status !== "cancelled")
        items.push({ kind: "notice", tier: "fyi", id: `notice:${p.id}:escalated:${t.id}`, ...base, stage: "implementation", text: `${taskLabel(t)} escalated after ${plural(t.reworkCount, "rework cycle")}`, href, since, level: "warning" });
      if (t.status === "blocked")
        items.push({ kind: "notice", tier: "fyi", id: `notice:${p.id}:blocked:${t.id}`, ...base, stage: "implementation", text: `${taskLabel(t)} is blocked${t.blockedBy ? `: ${t.blockedBy}` : ""}`, href, since, level: "warning" });
      if (t.qa.status === "bugs_found" && !p.stages.qa.approvedAt)
        items.push({ kind: "notice", tier: "fyi", id: `notice:${p.id}:bugs:${t.id}`, ...base, stage: "qa", text: `${taskLabel(t)}: QA found ${plural(t.qa.bugs.length, "bug")}${t.qa.bugs[0] ? ` (${t.qa.bugs[0]})` : ""}; rework loops back to implementation`, href, since, level: "warning" });
    }
  }
  const projectIds = new Set(entries.map((e) => e.pd.project.id));
  for (const n of snap.notices) {
    if (!global && !projectIds.has(n.projectId)) continue;
    const pd = entries.find((e) => e.pd.project.id === n.projectId)?.pd;
    items.push({ kind: "notice", tier: "fyi", id: n.id, projectId: n.projectId, projectName: pd?.project.name ?? (n.projectId || "Demo data"), stage: n.stage, text: n.text, href: pd ? `/projects/${pd.project.id}` : "/settings", since: n.at, level: n.level });
  }
  return items.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || sinceOf(a) - sinceOf(b));
}
