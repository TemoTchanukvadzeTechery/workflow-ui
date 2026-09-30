/**
 * Pending human requests per task, from the project bundle's inbox (the server joins key, phase
 * and taskId, and builds the task-page href with ?request=<runId>:<hId>).
 */
import type { InboxItem, ProjectBundle } from "@/lib/delivery/types";

export interface TaskRequestRef {
  runId: string;
  requestId: string;
  key?: string;
  phase?: string;
  question: string;
  href: string;
  /** "Developer review" for task:review:, "QA review" for qa:review:, else "Input needed". */
  label: string;
  waitingMs: number;
  createdAt: number;
  kind: "task-review" | "qa-review" | "other";
}

type HumanItem = Extract<InboxItem, { kind: "human" }>;

function refOf(item: HumanItem): TaskRequestRef {
  const key = item.key;
  const kind = key?.startsWith("task:review:") ? "task-review" : key?.startsWith("qa:review:") ? "qa-review" : "other";
  return {
    runId: item.entry.runId,
    requestId: item.entry.id,
    key,
    phase: item.phase,
    question: item.entry.question,
    href: item.href,
    label: kind === "task-review" ? "Developer review" : kind === "qa-review" ? "QA review" : "Input needed",
    waitingMs: item.waitingMs,
    createdAt: item.entry.createdAt,
    kind,
  };
}

/** taskId -> its pending requests, oldest first. */
export function pendingByTask(bundle: Pick<ProjectBundle, "inbox">): Map<string, TaskRequestRef[]> {
  const map = new Map<string, TaskRequestRef[]>();
  for (const item of bundle.inbox) {
    if (item.kind !== "human" || !item.taskId) continue;
    const list = map.get(item.taskId) ?? [];
    list.push(refOf(item));
    map.set(item.taskId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.createdAt - b.createdAt);
  return map;
}

/** Pending requests on the given runs (e.g. the dev-plan runs), not bound to a task. */
export function pendingForRuns(bundle: Pick<ProjectBundle, "inbox">, runIds: readonly string[]): TaskRequestRef[] {
  const set = new Set(runIds);
  return bundle.inbox.filter((i): i is HumanItem => i.kind === "human" && set.has(i.entry.runId)).map(refOf);
}
