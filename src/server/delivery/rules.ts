import "server-only";
/**
 * Pure predicates shared by the derived views, the scheduler and the store, so "is this task
 * startable" or "is this epic parked" means the same thing everywhere.
 */
import type { DeliveryTask, Epic, Project, StageId } from "@/lib/delivery/types";
import { TERMINAL_RUN_STATUSES, type RunStatus } from "@/lib/weft/types";

const AGENT_ACTIVE: readonly RunStatus[] = ["planning", "executing", "integrating", "verifying", "waiting_for_signal"];

export const isTerminal = (s: RunStatus | undefined) => !!s && TERMINAL_RUN_STATUSES.includes(s);
/** An agent is working (not paused on a human, not finished). */
export const isAgentActive = (s: RunStatus | undefined) => !!s && AGENT_ACTIVE.includes(s);
export const isOpenRun = (s: RunStatus | undefined) => !!s && !isTerminal(s);

/** A draft epic parked behind open questions (e.g. a candidate requirement blocked by Q3). */
export const isParked = (e: Epic) => e.status === "draft" && !!e.blockedBy?.length;

export const IN_FLIGHT: readonly DeliveryTask["status"][] = ["in_progress", "verifying", "in_review", "changes_requested"];
export const isInFlight = (t: DeliveryTask) => IN_FLIGHT.includes(t.status);
/** Occupies an agent slot (max 3 concurrent). A task waiting for review does not. */
export const usesAgent = (t: DeliveryTask) => t.status === "in_progress" || t.status === "verifying" || t.status === "changes_requested";

export function depsSatisfied(task: DeliveryTask, tasks: DeliveryTask[]): boolean {
  return task.dependencies.every((dep) => {
    const d = tasks.find((t) => t.id === dep);
    return !d || d.status === "done" || d.status === "cancelled";
  });
}

export function unmetDeps(task: DeliveryTask, tasks: DeliveryTask[]): string[] {
  return task.dependencies.filter((dep) => {
    const d = tasks.find((t) => t.id === dep);
    return d && d.status !== "done" && d.status !== "cancelled";
  });
}

export const isStartable = (task: DeliveryTask, tasks: DeliveryTask[]) => task.status === "ready" && depsSatisfied(task, tasks);

export function taskLabel(t: DeliveryTask): string {
  return t.jiraKey ?? t.id;
}

/** "T-2 (CP-52335)": the board id first, as the task board and plan show it. */
export function boardLabel(t: Pick<DeliveryTask, "id" | "jiraKey">): string {
  return t.jiraKey ? `${t.id} (${t.jiraKey})` : t.id;
}

export function stageRecord(project: Project, stage: StageId) {
  return project.stages[stage];
}

export function workflowStage(workflow: string, input?: unknown): StageId {
  switch (workflow) {
    case "po-brd":
      return "requirements";
    case "architect-aad":
      return "architecture";
    case "qa-verify":
      return "qa";
    case "dev-task":
      return (input as { origin?: string } | undefined)?.origin === "qa" ? "qa" : "implementation";
    default:
      return "implementation";
  }
}
