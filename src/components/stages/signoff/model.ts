/**
 * Read-model helpers for the PO Review summary: per-stage time, the decisions audit trail, the
 * QA history of each task (loop-backs and re-tests), the recording highlight of each epic and
 * the open questions left in the BRD and AAD.
 */
import { actorText } from "@/components/common";
import { STAGES, type AadReport, type Actor, type DeliveryTask, type DocumentArtifact, type Epic, type Evidence, type ProjectBundle, type StageId } from "@/lib/delivery/types";

export interface OpenQuestion {
  id: string;
  text: string;
  owner?: string;
}

/** The server sends parsed open questions on BRD/AAD documents; the shared type does not declare them yet. */
export function openQuestionsOf(doc: DocumentArtifact | undefined): OpenQuestion[] {
  const qs = (doc as (DocumentArtifact & { openQuestions?: OpenQuestion[] }) | undefined)?.openQuestions;
  return Array.isArray(qs) ? qs : [];
}

export function decisionsNeededOf(doc: DocumentArtifact | undefined): string[] {
  const r = doc?.lastReport as AadReport | undefined;
  return Array.isArray(r?.decisionsNeeded) ? r.decisionsNeeded : [];
}

export function acceptedDoc(bundle: ProjectBundle, kind: DocumentArtifact["kind"]): DocumentArtifact | undefined {
  const docs = bundle.documents.filter((d) => d.kind === kind);
  return docs.find((d) => d.status === "accepted") ?? docs.at(-1);
}

export interface StageTime {
  stage: StageId;
  n: number;
  title: string;
  short: string;
  startedAt?: number;
  endedAt?: number;
  /** Still running (no approval yet). */
  open: boolean;
  ms?: number;
  runs: number;
}

/**
 * Wall-clock time from a stage's start to its approval. Imported or never-started stages fall
 * back to the previous stage's approval; the current stage runs until `now`.
 */
export function stageTimes(bundle: ProjectBundle, now: number): StageTime[] {
  const p = bundle.project;
  let prevEnd: number | undefined = p.createdAt;
  return STAGES.map((def) => {
    const rec = p.stages[def.id];
    const view = bundle.stages[def.id];
    const reached = view.status !== "locked" && view.status !== "not_started";
    const startedAt = rec.startedAt ?? (reached || rec.approvedAt ? prevEnd : undefined);
    const open = !rec.approvedAt && reached && !p.done;
    const endedAt = rec.approvedAt ?? (open ? now : undefined);
    const ms = startedAt !== undefined && endedAt !== undefined ? Math.max(0, endedAt - startedAt) : undefined;
    if (rec.approvedAt) prevEnd = rec.approvedAt;
    return { stage: def.id, n: def.n, title: def.title, short: def.short, startedAt, endedAt, open, ms, runs: view.runs.length };
  });
}

export type LogEntry =
  | { kind: "decision"; id: string; at: number; by: Actor; stage: StageId; decision: "approved" | "changes_requested"; comment?: string; acknowledged?: string[] }
  | { kind: "reopened"; id: string; at: number; by: Actor; stage: StageId; fromStage: StageId; comment: string }
  | { kind: "waiver"; id: string; at: number; by: Actor; brRef: string; brText: string; comment?: string };

/** Every stage decision, reopening (send back) and trace waiver, newest first. */
export function decisionsLog(bundle: ProjectBundle): LogEntry[] {
  const out: LogEntry[] = [];
  for (const def of STAGES) {
    const rec = bundle.project.stages[def.id];
    // A reopen also records a "changes requested" decision with the same comment; show it once.
    const echoesReopen = (d: { decision: string; at: number; comment?: string }) =>
      d.decision === "changes_requested" && (rec.reopened ?? []).some((r) => r.comment === d.comment && Math.abs(r.at - d.at) < 5_000);
    for (const d of rec.decisions) {
      if (echoesReopen(d)) continue;
      out.push({ kind: "decision", id: `${def.id}-${d.id}`, at: d.at, by: d.by, stage: def.id, decision: d.decision, comment: d.comment, acknowledged: d.acknowledgedWarnings });
    }
    (rec.reopened ?? []).forEach((r, i) => out.push({ kind: "reopened", id: `${def.id}-reopen-${i}`, at: r.at, by: r.by, stage: def.id, fromStage: r.fromStage, comment: r.comment }));
  }
  for (const row of bundle.trace) {
    if (row.waiver) out.push({ kind: "waiver", id: `waiver-${row.brRef}`, at: row.waiver.at, by: row.waiver.by, brRef: row.brRef, brText: row.brText, comment: row.waiver.comment });
  }
  return out.sort((a, b) => b.at - a.at);
}

export function tasksOfEpic(bundle: ProjectBundle, epic: Epic): DeliveryTask[] {
  return bundle.tasks.filter((t) => t.epicId === epic.id && t.status !== "cancelled");
}

/** One recording per epic: the latest live video of its tasks, passing ones first. */
export function epicRecording(bundle: ProjectBundle, epic: Epic): { video: Evidence; task: DeliveryTask } | undefined {
  const tasks = tasksOfEpic(bundle, epic);
  const ids = new Set(tasks.map((t) => t.id));
  const videos = bundle.evidence
    .filter((e) => e.kind === "video" && e.url && !e.supersededBy && ids.has(e.taskId))
    .sort((a, b) => Number(b.result === "pass") - Number(a.result === "pass") || b.observedAt - a.observedAt);
  const video = videos[0];
  const task = video ? tasks.find((t) => t.id === video.taskId) : undefined;
  return video && task ? { video, task } : undefined;
}

export interface QaHistoryEntry {
  task: DeliveryTask;
  /** QA sent it back to implementation (bugs found) at least once. */
  loopedBack: boolean;
  /** The bugs QA reported: the open ones, or the ones the loop-back rework was asked to fix. */
  bugs: string[];
  /** qa-verify runs on this task. */
  qaRuns: number;
  /** dev-task runs on this task (the plan run plus every rework loop-back or retry). */
  devRuns: number;
}

/** The bullet lines of a loop-back's feedback ("- AC-2: …" per bug, as the server writes it). */
function feedbackBugs(feedback: string | undefined): string[] {
  return (feedback ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
}

/**
 * Tasks whose QA took more than one pass, from the task data: a QA loop-back (bugs found, then
 * rework) or a re-test (more than one qa-verify run). The rest passed QA on the first run.
 */
export function qaHistory(bundle: ProjectBundle): QaHistoryEntry[] {
  return bundle.tasks
    .filter((t) => t.status !== "cancelled")
    .map((t) => {
      const loopedBack = t.qa.status === "bugs_found" || t.reworkFrom === "qa";
      const bugs = t.qa.bugs.length ? t.qa.bugs : t.reworkFrom === "qa" ? feedbackBugs(t.lastFeedback) : [];
      return { task: t, loopedBack, bugs, qaRuns: t.qa.runIds.length, devRuns: t.runIds.length };
    })
    .filter((e) => e.loopedBack || e.qaRuns > 1);
}

/** "Maya Chen" of the latest sign-off. */
export function signedOffBy(bundle: ProjectBundle): { name: string; at: number; comment?: string } | undefined {
  const d = [...bundle.project.stages.signoff.decisions].reverse().find((x) => x.decision === "approved");
  if (!d) return undefined;
  return { name: actorText(d.by), at: bundle.project.doneAt ?? d.at, comment: d.comment };
}
