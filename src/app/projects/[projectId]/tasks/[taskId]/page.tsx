import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getRuntime } from "@/server/runtime";
import { TaskDetailView } from "./_view";

type Params = { projectId: string; taskId: string };

/** Whether the project has the task; `undefined` when the lookup itself failed (the client view decides). */
async function taskExists(projectId: string, taskId: string): Promise<boolean | undefined> {
  try {
    const rt = getRuntime();
    await rt.ready;
    const pd = rt.store.find(projectId);
    // An unknown project is the layout's 404.
    if (!pd) return undefined;
    return pd.tasks.some((t) => t.id === taskId);
  } catch {
    return undefined;
  }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { projectId, taskId } = await params;
  return { title: (await taskExists(projectId, taskId)) === false ? "Task not found" : taskId };
}

/** The task page: header, attempts, the run ledger, Changes / Checks / AC / Agent log / Evidence / Notes, and the pending review. */
export default async function TaskPage({ params }: { params: Promise<Params> }) {
  const { projectId, taskId } = await params;
  // Before the Suspense boundary: once a fallback streams, the status is fixed at 200.
  if ((await taskExists(projectId, taskId)) === false) notFound();
  // TaskDetailView reads ?request= with useSearchParams, which needs a Suspense boundary.
  return (
    <Suspense>
      <TaskDetailView projectId={projectId} taskId={taskId} />
    </Suspense>
  );
}
