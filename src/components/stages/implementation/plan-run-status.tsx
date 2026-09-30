"use client";

/**
 * Live status of a dev-plan run: its phases (Context -> Plan N -> your review) as a stepper,
 * the step running now with elapsed time, and spend so far. Refreshed by live.ts (SSE).
 */
import { Check, CircleDashed, CircleX, UserRound } from "lucide-react";
import { Elapsed, ErrorState, SectionCard, StatusDot, StatusPill } from "@/components/common";
import { RunChip } from "@/components/stage";
import { Skeleton } from "@/components/ui/skeleton";
import { useRun } from "@/lib/api/queries";
import { formatTokens, formatUsd, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { runStatusMeta } from "@/lib/weft/labels";
import { TERMINAL_RUN_STATUSES, type RunDetail, type StepState } from "@/lib/weft/types";

/** Plain words for dev-plan step labels. */
export function planStepText(step: Pick<StepState, "label" | "key" | "kind">): string {
  const label = step.label ?? step.key ?? step.kind;
  if (label.startsWith("read:")) return `Reading ${label.slice(5)}`;
  if (label === "context") return "Building context from the BRD, AAD, memory and your notes";
  const plan = /^plan:(\d+)$/.exec(label);
  if (plan) return `Drafting the plan (round ${plan[1]})`;
  const integ = /^integrate:plan:(\d+)$/.exec(label);
  if (integ) return `Writing the plan file (round ${integ[1]})`;
  return label;
}

type PhaseState = "done" | "running" | "waiting" | "failed" | "todo";

function phaseStates(run: RunDetail): Array<{ name: string; state: PhaseState; steps: StepState[] }> {
  const bySeq = new Map(run.steps.map((s) => [s.seq, s]));
  const pendingReview = run.humans.find((h) => h.status === "pending" && h.kind !== "gate");
  const phases = run.phases.map((p, i) => {
    const steps = p.steps.map((seq) => bySeq.get(seq)).filter((s): s is StepState => !!s);
    const last = i === run.phases.length - 1;
    let state: PhaseState = "done";
    if (steps.some((s) => s.status === "failed") && run.status === "failed") state = "failed";
    else if (steps.some((s) => s.status === "running")) state = "running";
    else if (last && pendingReview && pendingReview.phase === p.name) state = "waiting";
    else if (last && !TERMINAL_RUN_STATUSES.includes(run.status)) state = "running";
    return { name: p.name, state, steps };
  });
  return phases;
}

const PHASE_ICON: Record<PhaseState, typeof Check> = { done: Check, running: CircleDashed, waiting: UserRound, failed: CircleX, todo: CircleDashed };

export function PlanRunStatus({ runId, className }: { runId: string; className?: string }) {
  const q = useRun(runId);
  if (q.isPending) {
    return (
      <div className={cn("card-surface space-y-3 rounded-2xl p-4", className)} aria-busy="true">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (q.error || !q.data) return <ErrorState size="sm" title="Could not load the dev-plan run" error={q.error} onRetry={() => void q.refetch()} className="card-surface rounded-2xl" />;
  const run = q.data;
  const phases = phaseStates(run);
  const running = [...run.steps].reverse().find((s) => s.status === "running");
  const terminal = TERMINAL_RUN_STATUSES.includes(run.status);
  const waiting = run.status === "waiting_for_human";
  const meta = runStatusMeta(run.status);
  const title = terminal ? (run.status === "complete" ? "Planning finished" : run.status === "failed" ? "Planning failed" : "Planning cancelled") : waiting ? "The plan is ready for your review" : "Generating the plan";

  return (
    <SectionCard
      density="dense"
      kicker="dev-plan"
      title={title}
      className={className}
      actions={<RunChip runId={run.runId} workflow={run.workflow} status={run.status} />}
    >
      <div className="space-y-3">
        <ol className="flex flex-wrap items-center gap-1.5" aria-label="Run phases">
          {phases.map((p, i) => {
            const Icon = PHASE_ICON[p.state];
            return (
              <li key={p.name} className="flex items-center gap-1.5">
                {i > 0 ? <span aria-hidden className="h-px w-4 bg-border" /> : null}
                <span
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
                    p.state === "done" && "bg-status-success-bg text-status-success-fg",
                    p.state === "running" && "bg-status-running-bg text-status-running-fg",
                    p.state === "waiting" && "bg-status-attention-bg text-status-attention-fg",
                    p.state === "failed" && "bg-status-danger-bg text-status-danger-fg",
                    p.state === "todo" && "bg-muted text-muted-foreground",
                  )}
                >
                  {p.state === "running" ? <StatusDot tone="running" pulse size="sm" /> : <Icon aria-hidden className="size-3.5" />}
                  {p.name}
                  <span className="sr-only">: {p.state === "waiting" ? "waiting for your review" : p.state}</span>
                </span>
              </li>
            );
          })}
          {!terminal && !waiting ? (
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-px w-4 bg-border" />
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 text-xs text-muted-foreground">
                <UserRound aria-hidden className="size-3.5" />
                Your review
              </span>
            </li>
          ) : null}
        </ol>

        {running ? (
          <p className="flex min-w-0 items-center gap-2 text-[13px]" aria-live="polite">
            <StatusDot tone="running" pulse />
            <span className="min-w-0 truncate">{planStepText(running)}</span>
            <Elapsed since={running.startedAt} className="ml-auto shrink-0 font-mono text-xs text-muted-foreground" />
          </p>
        ) : waiting ? (
          <p className="text-[13px] text-muted-foreground">The run is paused until you approve the plan or ask for a revision.</p>
        ) : run.status === "failed" ? (
          <p className="text-[13px] text-status-danger-fg">{run.error?.message ?? "The run failed."}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <StatusPill {...meta} size="sm" />
          <span className="tabular-nums">{plural(run.steps.length, "step")}</span>
          <span className="font-mono tabular-nums">
            <Elapsed since={run.createdAt} until={terminal || waiting ? run.updatedAt : undefined} />
          </span>
          <span className="font-mono tabular-nums">{formatTokens(run.budget.tokens)}</span>
          <span className="font-mono tabular-nums">{formatUsd(run.budget.usd)}</span>
        </div>
      </div>
    </SectionCard>
  );
}
