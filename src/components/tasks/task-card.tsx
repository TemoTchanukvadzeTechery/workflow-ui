"use client";

/**
 * One task on the board (brief D.3 pattern 9, the agent HUD): ids, title, repo, the agent at work
 * with the time on its current attempt or rework and its live latest step, checks and diff
 * stats, rework / escalation badges, why a ready task has not started (queued behind a
 * dependency), and the one action that matters now: Review (a task:review is waiting) or Start.
 */
import { ArrowRight, Eye, Hourglass, Play } from "lucide-react";
import Link from "next/link";
import { Elapsed, StatusDot } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { DeliveryTask } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import type { TaskRequestRef } from "./pending";
import {
  AgentAvatar,
  BlockedLine,
  ChecksStat,
  DepChips,
  DiffStat,
  EscalatedBadge,
  MiniChip,
  QaReworkBadge,
  RepoChip,
  ReworkBadge,
  ScopedTitle,
  TaskIdLabel,
  attemptStartedAt,
  isAgentWorking,
  isQueued,
  taskHref,
  waitReason,
} from "./task-bits";

export interface TaskCardProps {
  task: DeliveryTask;
  projectId: string;
  /** All tasks, for dependency status. */
  tasks: readonly DeliveryTask[];
  pending?: TaskRequestRef[];
  model?: string;
  /** Show "Start task" (ready, plan approved, stage open, not started manually yet). */
  canStart?: boolean;
  starting?: boolean;
  onStart?: () => void;
  /** createdAt of a run, so the timer counts from the current attempt rather than the first. */
  runCreatedAt?: (runId: string) => number | undefined;
  className?: string;
}

export function TaskCard({ task, projectId, tasks, pending = [], model, canStart, starting, onStart, runCreatedAt, className }: TaskCardProps) {
  const working = isAgentWorking(task);
  const review = pending[0];
  const href = taskHref(projectId, task.id);
  const reviewHref = review ? taskHref(projectId, task.id, `${review.runId}:${review.requestId}`) : undefined;
  const hasFlags = task.reworkCount > 0 || task.escalated || task.reworkFrom === "qa";
  const showDeps = task.status === "ready" || task.status === "blocked";
  const queued = isQueued(task);
  const wait = waitReason(task, tasks);
  const since = working ? attemptStartedAt(task, runCreatedAt) : undefined;
  const reworking = working && task.reworkCount > 0 && task.devReview?.decision === "changes_requested";

  return (
    <article
      aria-label={`${task.id} ${task.title}`}
      className={cn(
        "group/card relative flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,.04)] transition-colors duration-150 hover:border-foreground/20",
        review && "border-status-review-fg/40 ring-1 ring-status-review-fg/25",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <TaskIdLabel task={task} className="min-w-0 flex-1" />
        <MiniChip title={`Wave ${task.wave}`}>W{task.wave}</MiniChip>
        <MiniChip title={`Size ${task.size}`}>{task.size}</MiniChip>
      </div>

      <h3 className="text-[13px] leading-snug font-medium text-foreground">
        <Link href={href} className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] hover:underline focus-visible:ring-2 focus-visible:ring-ring">
          <ScopedTitle title={task.title} hideScope={task.repo} />
        </Link>
      </h3>

      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <RepoChip repo={task.repo} />
      </div>

      {hasFlags ? (
        <div className="flex flex-wrap items-center gap-1">
          {task.reworkFrom === "qa" ? <QaReworkBadge /> : null}
          <ReworkBadge count={task.reworkCount} />
          {task.escalated ? <EscalatedBadge /> : null}
        </div>
      ) : null}

      {working ? (
        <div className="space-y-1 rounded-lg bg-status-running-bg/60 px-2 py-1.5">
          <AgentAvatar model={model} live />
          <p className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-status-running-fg" aria-live="polite">
            <StatusDot tone="running" pulse size="sm" />
            <span className="min-w-0 flex-1 truncate" title={task.latestStep}>
              {task.latestStep ?? "Working"}
            </span>
            {since ? (
              <span title={reworking ? `Time on rework ${task.reworkCount}` : "Time on this attempt"} className="shrink-0 tabular-nums">
                <Elapsed since={since} />
              </span>
            ) : null}
          </p>
        </div>
      ) : task.status === "in_review" && task.latestStep ? (
        <p className="truncate font-mono text-[11px] text-status-review-fg" title={task.latestStep}>
          {task.latestStep}
        </p>
      ) : null}

      {task.checks.length > 0 || task.diffStats ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ChecksStat checks={task.checks} />
          <DiffStat stats={task.diffStats} />
          {task.status === "done" && task.finishedAt && task.startedAt ? (
            <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums" title="Time from start to approval">
              <Elapsed since={task.startedAt} until={task.finishedAt} style="human" />
            </span>
          ) : null}
        </div>
      ) : null}

      {task.status === "blocked" ? <BlockedLine reason={task.blockedBy} /> : null}
      {showDeps && task.dependencies.length > 0 ? <DepChips deps={task.dependencies} tasks={tasks} projectId={projectId} className="relative z-[1]" /> : null}
      {wait ? (
        <p className="flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
          <Hourglass aria-hidden className="mt-px size-3 shrink-0" />
          <span className="min-w-0">
            {queued ? "Queued · " : ""}
            {wait.charAt(0).toUpperCase() + wait.slice(1)}
          </span>
        </p>
      ) : null}

      {reviewHref || (canStart && onStart) ? (
        <div className="relative z-[1] flex items-center gap-2 pt-0.5">
          {reviewHref && review ? (
            <Button asChild size="sm" className="h-7 flex-1 rounded-full bg-status-review-fg text-white hover:bg-status-review-fg/85 dark:text-background">
              <Link href={reviewHref}>
                <Eye aria-hidden />
                {review.kind === "qa-review" ? "QA review" : "Review"}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : null}
          {canStart && onStart ? (
            <Button size="sm" variant="outline" className="h-7 rounded-full" onClick={onStart} disabled={starting}>
              {starting ? <Spinner aria-hidden /> : <Play aria-hidden />}
              Start task
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
