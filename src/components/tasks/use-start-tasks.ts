"use client";

/**
 * Start ready tasks (POST /tasks/start) with a toast that says what actually happened. The shared
 * useStartTasks hook always toasts "N agent run(s) started", which reads "0 agent run(s) started"
 * when the tasks were only queued behind dependencies or the 3-agent limit; this one explains the
 * queue instead. Same client call and the same cache invalidation as the shared mutations.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { delivery } from "@/lib/api/client";
import type { DeliveryTask, TaskStartBody } from "@/lib/delivery/types";
import { plural } from "@/lib/format";
import { unmetDeps } from "./task-bits";

/** Agents that may run at once (the orchestrator's limit). */
export const AGENT_LIMIT = 3;

/** "T-4 (CP-52337)": the board's id first, the Jira key alongside once the epics are synced. */
function boardLabel(t: Pick<DeliveryTask, "id" | "jiraKey">): string {
  return t.jiraKey ? `${t.id} (${t.jiraKey})` : t.id;
}

/** Why ready tasks did not start right away, in the ids the board shows ("T-4 waits for T-2"). */
export function queueReason(targets: readonly DeliveryTask[], tasks: readonly DeliveryTask[]): string {
  const waiting = targets.map((t) => ({ t, deps: unmetDeps(t, tasks) })).filter((x) => x.deps.length > 0);
  if (waiting.length > 0) {
    const first = waiting[0]!;
    const rest = waiting.length > 1 ? ` (+${waiting.length - 1} more waiting on dependencies)` : "";
    return `${boardLabel(first.t)} waits for ${first.deps.join(", ")}${rest}. It starts on its own once ${first.deps.length === 1 ? "that is" : "they are"} approved.`;
  }
  const busy = tasks.filter((t) => t.status === "in_progress" || t.status === "verifying" || t.status === "changes_requested").length;
  if (busy >= AGENT_LIMIT) return `${busy} agents are already working (limit ${AGENT_LIMIT}). Queued tasks start as soon as one finishes.`;
  return "They are queued and start as soon as an agent slot is free.";
}

export function useStartTasksWorded(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { body: TaskStartBody; targets: DeliveryTask[]; tasks: DeliveryTask[] }) => delivery.startTasks(projectId, v.body),
    onSuccess: (r, v) => {
      for (const key of [["dashboard"], ["projects"], ["inbox"], ["activity"], ["weft"], ["project", projectId]]) void qc.invalidateQueries({ queryKey: key });
      const n = r.runIds.length;
      const queued = Math.max(0, v.targets.length - n);
      if (n > 0 && queued === 0) toast.success(`${plural(n, "agent run")} started`);
      else if (n > 0) toast.success(`${plural(n, "agent run")} started, ${queued} queued`, { description: queueReason(v.targets, v.tasks) });
      else toast.info(`${plural(v.targets.length, "task")} queued`, { description: queueReason(v.targets, v.tasks) });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
