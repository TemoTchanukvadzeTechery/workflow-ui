"use client";

/**
 * One task on the board (brief D.3 pattern 9, the agent HUD): ids, title, repo, the agent at work
 * with the time on its current attempt or rework and its live latest step, checks and diff
 * stats, rework / escalation badges, why a ready task has not started (queued behind a
 * dependency), and the one action that matters now: Review (a task:review is waiting) or Start.
 */
import { ArrowRight, Eye, Hourglass, Play } from "lucide-react";
import Link from "next/link";
import { Elapsed, StatusDot, StripedBar } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { DeliveryTask } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import type { TaskRequestRef } from "./pending";
import {
  AgentAvatar,
  BlockedLine,
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
  latestChecks,
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
  const checks = latestChecks(task.checks);
  const passed = checks.filter((c) => c.status === "pass").length;
  const checksOk = passed === checks.length;

  return (
    <article
      aria-label={`${task.id} ${task.title}`}
      className={cn(
        // A raised card inside the lane's well (STYLE.md 1): the reference's selected-segment surface with a soft lift.
        "group/card relative flex min-w-0 flex-col gap-2.5 rounded-[16px] bg-raised p-3.5 shadow-[var(--raised-shadow),0_10px_24px_-18px_rgb(0_0_0/0.35)] transition-shadow duration-150 hover:shadow-[var(--raised-shadow),0_14px_30px_-16px_rgb(0_0_0/0.4)]",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <TaskIdLabel task={task} className="min-w-0 flex-1" />
        {review ? <StatusDot tone="review" size="lg" label={review.kind === "qa-review" ? "QA review waiting on you" : "Review waiting on you"} /> : null}
        <MiniChip title={`Wave ${task.wave}`}>W{task.wave}</MiniChip>
        <MiniChip title={`Size ${task.size}`}>{task.size}</MiniChip>
      </div>

      <h3 className="text-[15px] leading-[21px] font-medium tracking-[-0.01em] text-heading">
        <Link href={href} className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-[16px] after:content-[''] hover:underline focus-visible:after:ring-3 focus-visible:after:ring-ring/50">
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
        <div className="space-y-1.5 rounded-[12px] bg-status-running-bg px-2.5 py-2">
          <AgentAvatar model={model} live />
          <p className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-status-running-fg" aria-live="polite">
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
        <p className="truncate text-[13px] text-muted-foreground" title={task.latestStep}>
          {task.latestStep}
        </p>
      ) : null}

      {checks.length > 0 ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs">
            <span className={cn("tabular-nums", checksOk ? "text-status-success-fg" : "text-status-danger-fg")}>
              {passed}/{checks.length} checks
            </span>
            <span className="flex-1" />
            <DiffStat stats={task.diffStats} />
            {task.status === "done" && task.finishedAt && task.startedAt ? (
              <span className="font-mono text-xs text-muted-foreground tabular-nums" title="Time from start to approval">
                <Elapsed since={task.startedAt} until={task.finishedAt} style="human" />
              </span>
            ) : null}
          </div>
          <StripedBar value={passed} max={checks.length} tone={checksOk ? "success" : "danger"} height={8} label={`${passed} of ${checks.length} checks passed`} />
        </div>
      ) : task.diffStats ? (
        <DiffStat stats={task.diffStats} />
      ) : null}

      {task.status === "blocked" ? <BlockedLine reason={task.blockedBy} /> : null}
      {showDeps && task.dependencies.length > 0 ? <DepChips deps={task.dependencies} tasks={tasks} projectId={projectId} className="relative z-[1]" /> : null}
      {wait ? (
        <p className="flex items-start gap-1.5 text-xs leading-4 text-muted-foreground">
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
            <Button asChild size="sm">
              <Link href={reviewHref}>
                <Eye aria-hidden />
                {review.kind === "qa-review" ? "QA review" : "Review"}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : null}
          {canStart && onStart ? (
            <Button size="sm" variant="secondary" onClick={onStart} disabled={starting}>
              {starting ? <Spinner aria-hidden /> : <Play aria-hidden />}
              Start task
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
