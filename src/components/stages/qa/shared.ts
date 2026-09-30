/**
 * Read-model helpers for the QA workspace: which human request belongs to which task, which
 * tasks can be sent to QA (or re-tested), why a task is blocked, and the loop-back state of a
 * task QA rejected.
 */
import type { Decision, DeliveryTask, InboxItem, ProjectBundle } from "@/lib/delivery/types";
import type { PendingEntry } from "@/lib/weft/types";

export type HumanInboxItem = Extract<InboxItem, { kind: "human" }>;

export interface TaskRequest {
  runId: string;
  requestId: string;
  entry: PendingEntry;
  key?: string;
}

function humans(bundle: ProjectBundle): HumanInboxItem[] {
  return bundle.inbox.filter((i): i is HumanInboxItem => i.kind === "human");
}

/** The pending qa:review of a task (on one of its qa-verify runs), if any. */
export function pendingQaReview(bundle: ProjectBundle, task: DeliveryTask): TaskRequest | undefined {
  const item = humans(bundle).find((i) => task.qa.runIds.includes(i.entry.runId) && (i.key === undefined || i.key.startsWith("qa:review")));
  return item ? { runId: item.entry.runId, requestId: item.entry.id, entry: item.entry, key: item.key } : undefined;
}

/** The pending developer review (task:review) of a loop-back dev-task run, if any. */
export function pendingDevReview(bundle: ProjectBundle, task: DeliveryTask): TaskRequest | undefined {
  const item = humans(bundle).find((i) => task.runIds.includes(i.entry.runId));
  return item ? { runId: item.entry.runId, requestId: item.entry.id, entry: item.entry, key: item.key } : undefined;
}

export function taskHref(projectId: string, taskId: string, request?: { runId: string; requestId: string }): string {
  const base = `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`;
  return request ? `${base}?request=${request.runId}:${request.requestId}` : base;
}

/** Done tasks QA has not started on (or that were blocked): what "Run QA agents" starts. */
export function isQaEligible(t: DeliveryTask): boolean {
  return t.status === "done" && (t.qa.status === "pending" || t.qa.status === "blocked");
}

/**
 * A done task a new qa-verify run can start on: anything but a run in progress or waiting for
 * review. qa/start accepts these by id, so QA can re-test a certified or blocked task (e.g.
 * after a send-back from PO Review).
 */
export function canRunQa(t: DeliveryTask): boolean {
  return t.status === "done" && t.qa.status !== "testing" && t.qa.status !== "in_review";
}

/** QA already has a verdict on it, so a new run is a re-test (its evidence supersedes the old). */
export function canRetest(t: DeliveryTask): boolean {
  return canRunQa(t) && t.qa.status !== "pending";
}

/**
 * Why a task is blocked for QA: the comment QA gave with the Blocked verdict, or the failed run
 * that blocked it. Undefined when the task is not blocked.
 */
export function qaBlockedReason(bundle: ProjectBundle, t: DeliveryTask): { text: string; review?: Decision } | undefined {
  if (t.qa.status !== "blocked") return undefined;
  const lastRun = t.qa.runIds.at(-1);
  const status = bundle.stages.qa.runs.find((r) => r.runId === lastRun)?.status;
  if (status === "failed") return { text: `qa-verify run ${lastRun} failed` };
  const review = t.qa.verdict === "blocked" ? t.qa.review : undefined;
  return { text: review?.comment ?? "No reason given", review };
}

export function activeTasks(bundle: ProjectBundle): DeliveryTask[] {
  return bundle.tasks.filter((t) => t.status !== "cancelled");
}

/** QA rejected it and the rework is (or was) back in implementation. */
export function isLoopedBack(t: DeliveryTask): boolean {
  return t.qa.status === "bugs_found";
}

/** QA is testing a task again after a loop-back. */
export function isRetesting(t: DeliveryTask): boolean {
  return (t.qa.status === "testing" || t.qa.status === "in_review") && t.qa.runIds.length > 1;
}

export function taskKey(t: DeliveryTask): string {
  return t.jiraKey ?? t.id;
}
