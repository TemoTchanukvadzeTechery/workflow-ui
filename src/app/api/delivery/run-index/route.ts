/**
 * GET /api/delivery/run-index → Record<runId, { projectId, projectName, stage, taskId?, workflow }>.
 * Weft has no project concept, so the run inspector joins runs to projects through this
 * read-only index built from the delivery store (stage runIds, task dev/QA runIds, run owners).
 * A static segment, so it wins over the /api/delivery/[...path] catch-all.
 */
import type { StageId } from "@/lib/delivery/types";
import type { RunIndex } from "@/components/runs/run-index-types";
import { getRuntime } from "@/server/runtime";

export const dynamic = "force-dynamic";

const STAGE_WORKFLOW: Record<StageId, string> = {
  requirements: "po-brd",
  architecture: "architect-aad",
  implementation: "dev-plan",
  qa: "qa-verify",
  signoff: "",
};

export async function GET(): Promise<Response> {
  try {
    const rt = getRuntime();
    await rt.ready;
    const index: RunIndex = {};
    for (const pd of rt.store.list()) {
      const { project } = pd;
      const base = { projectId: project.id, projectName: project.name, projectKey: project.key };
      for (const [stage, st] of Object.entries(project.stages) as Array<[StageId, (typeof project.stages)[StageId]]>) {
        for (const runId of st.runIds) {
          const owner = rt.store.owners.get(runId);
          index[runId] = { ...base, stage, workflow: owner?.workflow ?? STAGE_WORKFLOW[stage], ...(owner?.taskId ? { taskId: owner.taskId } : {}) };
        }
      }
      for (const task of pd.tasks) {
        // A QA loop-back dev-task run may be registered on the QA stage: keep the owner's stage.
        for (const runId of task.runIds) index[runId] = { ...base, stage: rt.store.owners.get(runId)?.stage ?? "implementation", taskId: task.id, taskTitle: task.title, workflow: "dev-task" };
        for (const runId of task.qa.runIds) index[runId] = { ...base, stage: rt.store.owners.get(runId)?.stage ?? "qa", taskId: task.id, taskTitle: task.title, workflow: "qa-verify" };
      }
    }
    // Runs the orchestrator saw that no stage list holds yet (just started).
    for (const [runId, owner] of rt.store.owners) {
      if (index[runId]) continue;
      const pd = rt.store.find(owner.projectId);
      if (!pd) continue;
      const task = owner.taskId ? pd.tasks.find((t) => t.id === owner.taskId) : undefined;
      index[runId] = {
        projectId: pd.project.id,
        projectName: pd.project.name,
        projectKey: pd.project.key,
        stage: owner.stage,
        workflow: owner.workflow,
        ...(owner.taskId ? { taskId: owner.taskId } : {}),
        ...(task ? { taskTitle: task.title } : {}),
      };
    }
    return Response.json(index, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
