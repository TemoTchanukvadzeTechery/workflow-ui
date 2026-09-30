"use client";

/**
 * The Execution sub-step (brief C.3): a short stat strip (done, agents working, awaiting review,
 * changes requested, blocked), the reviews waiting on you, then the TaskBoard (kanban or table,
 * wave headers, manual start controls). Everything refreshes live from SSE.
 */
import { ArrowRight, Bot, CircleCheck, Eye, OctagonPause, RotateCcw } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState, toneClasses } from "@/components/common";
import { TimeAgo } from "@/components/hitl";
import { AGENT_LIMIT, EscalatedBadge, MAX_REWORK, ReworkBadge, ScopedTitle, TaskBoard, TaskIdLabel, pendingByTask, taskHref, type StartMode, type TaskRequestRef } from "@/components/tasks";
import type { ProjectBundle } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/weft/labels";

function Stat({ label, value, sub, icon: Icon, tone }: { label: string; value: ReactNode; sub?: ReactNode; icon: typeof Bot; tone: Tone }) {
  const t = toneClasses(tone);
  return (
    <div className="card-surface flex min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5">
      <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full", t.bg, t.text)}>
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl leading-7 font-normal tracking-[-0.02em] tabular-nums">{value}</div>
        {sub ? <div className="truncate text-[11px] text-muted-foreground">{sub}</div> : null}
      </div>
    </div>
  );
}

export function ExecutionStep({ projectId, bundle, canManage }: { projectId: string; bundle: ProjectBundle; canManage: boolean }) {
  const record = bundle.project.stages.implementation;
  const tasks = bundle.tasks;
  const pending = pendingByTask(bundle);

  if (!record.planApprovedAt) {
    return <EmptyState icon={OctagonPause} title="Execution starts after the plan is approved" body="Generate tasks in the Plan step, review them and approve the plan. Agents then pick up the tasks wave by wave." />;
  }
  if (tasks.length === 0) {
    return <EmptyState icon={OctagonPause} title="The approved plan has no tasks" body="Nothing to execute. Reopen the stage to plan again, or hand off to QA if this is intended." />;
  }

  const active = tasks.filter((t) => t.status !== "cancelled");
  const done = active.filter((t) => t.status === "done").length;
  const working = tasks.filter((t) => t.status === "in_progress" || t.status === "verifying" || t.status === "changes_requested").length;
  const reviews = [...pending.entries()].flatMap(([taskId, refs]) => refs.filter((r) => r.kind === "task-review").map((r) => ({ taskId, ref: r })));
  const rework = tasks.filter((t) => t.status === "changes_requested" || (t.status === "in_progress" && t.reworkCount > 0)).length;
  const blocked = tasks.filter((t) => t.status === "blocked").length;
  const cancelled = tasks.length - active.length;
  const runStarts = new Map([...bundle.stages.implementation.runs, ...bundle.stages.qa.runs].map((r) => [r.runId, r.createdAt] as const));

  return (
    <div className="space-y-4">
      <div className="@container">
        <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
          <Stat label="Done" value={`${done}/${active.length}`} sub={cancelled ? `${cancelled} cancelled` : "approved"} icon={CircleCheck} tone="success" />
          <Stat label="Agents working" value={`${working}/${AGENT_LIMIT}`} sub="3 at most" icon={Bot} tone="running" />
          <Stat label="Your reviews" value={reviews.length} sub="waiting on you" icon={Eye} tone="review" />
          <Stat
            label="In rework"
            value={rework}
            sub={blocked ? `${blocked} blocked · needs a decision` : "0 blocked"}
            icon={RotateCcw}
            tone={blocked ? "attention" : "neutral"}
          />
        </div>
      </div>

      {reviews.length > 0 ? <ReviewQueue projectId={projectId} bundle={bundle} reviews={reviews} /> : null}

      <TaskBoard projectId={projectId} tasks={tasks} pending={pending} canManage={canManage} startMode={(record.startMode ?? "manual") as StartMode} runCreatedAt={(id) => runStarts.get(id)} />
    </div>
  );
}

function ReviewQueue({ projectId, bundle, reviews }: { projectId: string; bundle: ProjectBundle; reviews: Array<{ taskId: string; ref: TaskRequestRef }> }) {
  return (
    <section aria-label="Reviews waiting on you" className="rounded-2xl border border-status-review-fg/25 bg-status-review-bg/50 p-3">
      <h2 className="flex items-center gap-2 px-1 pb-2 text-[13px] font-medium text-status-review-fg">
        <Eye aria-hidden className="size-4" />
        {reviews.length === 1 ? "1 task is waiting for your review" : `${reviews.length} tasks are waiting for your review`}
      </h2>
      <ul className="flex flex-col gap-1.5">
        {reviews.map(({ taskId, ref }) => {
          const task = bundle.tasks.find((t) => t.id === taskId);
          if (!task) return null;
          // The question starts with "Escalated: " once the rework limit is used up (dev-task).
          const escalated = task.escalated || /^Escalated:/.test(ref.question);
          const cycle = Number(/^task:review:(\d+)$/.exec(ref.key ?? "")?.[1] ?? 0);
          const reworks = Math.max(task.reworkCount, cycle > 0 ? cycle - 1 : 0);
          return (
            <li key={`${ref.runId}:${ref.requestId}`}>
              <Link
                href={taskHref(projectId, taskId, `${ref.runId}:${ref.requestId}`)}
                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-card px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,.04)] hover:ring-1 hover:ring-status-review-fg/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <TaskIdLabel task={task} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                  <ScopedTitle title={task.title} />
                </span>
                {escalated ? (
                  <span className="inline-flex items-center gap-1.5">
                    <EscalatedBadge />
                    <span className="text-xs text-status-danger-fg tabular-nums">
                      {reworks}/{MAX_REWORK} reworks used
                    </span>
                  </span>
                ) : (
                  <ReworkBadge count={reworks} />
                )}
                <span className="font-mono text-[11px] text-muted-foreground">{ref.key}</span>
                <TimeAgo at={ref.createdAt} prefix="waiting " elapsed className="text-xs text-muted-foreground" />
                <span className="inline-flex items-center gap-1 text-xs font-medium text-status-review-fg">
                  Review
                  <ArrowRight aria-hidden className="size-3.5" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
