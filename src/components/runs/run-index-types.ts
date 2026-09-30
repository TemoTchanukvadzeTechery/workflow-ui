/** Wire shape of GET /api/delivery/run-index: which project, stage and task each weft run belongs to. */
import type { StageId } from "@/lib/delivery/types";

export interface RunIndexEntry {
  projectId: string;
  projectName: string;
  /** Short project key, e.g. "AGR". */
  projectKey?: string;
  stage: StageId;
  taskId?: string;
  /** Task title when the run belongs to a task. */
  taskTitle?: string;
  workflow: string;
}

export type RunIndex = Record<string, RunIndexEntry>;
