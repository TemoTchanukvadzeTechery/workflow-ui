"use client";

/**
 * The five-stage pipeline. Large: five cards (number, icon, title, owner, status, metric), the
 * current one ringed and in-progress ones hatched; a done project has no current stage. Compact:
 * a segmented bar with stage titles. Stages carry no color of their own; color always means status.
 */
import Link from "next/link";
import { StageIcon } from "@/components/common";
import { STAGES, type StageId, type StageStatus, type StageView } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { STAGE_STATUS_META, StageStatusPill } from "../hitl/bits";

/** Hatch for partial/in-progress: 135deg stripes of currentColor at ~35% opacity. */
export const HATCH_STYLE = { backgroundImage: "repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 6px)", opacity: 0.35 } as const;

const HATCHED: ReadonlySet<StageStatus> = new Set<StageStatus>(["in_progress", "needs_input", "in_review"]);

const SEGMENT_COLOR: Record<StageStatus, string> = {
  locked: "text-status-neutral-fg/40",
  not_started: "text-status-neutral-fg/40",
  in_progress: "text-status-running-fg",
  needs_input: "text-status-attention-fg",
  in_review: "text-status-review-fg",
  approved: "text-status-success-fg",
  failed: "text-status-danger-fg",
};

export interface StageStepperProps {
  projectId: string;
  stages: Record<StageId, StageView>;
  current: StageId;
  /** The project is done: no stage is "current" any more. */
  done?: boolean;
  variant: "large" | "compact";
  className?: string;
}

function Segment({ status }: { status: StageStatus }) {
  const hatched = HATCHED.has(status);
  return (
    <span aria-hidden className={cn("relative block h-1.5 overflow-hidden rounded-full", SEGMENT_COLOR[status])}>
      {hatched ? (
        <>
          <span className="absolute inset-0 rounded-full bg-current opacity-20" />
          <span className="absolute inset-0" style={HATCH_STYLE} />
        </>
      ) : (
        <span className={cn("absolute inset-0 rounded-full bg-current", status === "locked" || status === "not_started" ? "opacity-60" : "")} />
      )}
    </span>
  );
}

export function StageStepper({ projectId, stages, current, done, variant, className }: StageStepperProps) {
  if (variant === "compact") {
    return (
      <nav aria-label="Stages" className={cn("@container min-w-0", className)}>
        <ol className="grid grid-cols-5 gap-1.5">
          {STAGES.map((def) => {
            const view = stages[def.id];
            const status = view?.status ?? "locked";
            const isCurrent = !done && def.id === current;
            return (
              <li key={def.id} className="min-w-0">
                <Link
                  href={`/projects/${projectId}/${def.id}`}
                  aria-current={isCurrent ? "step" : undefined}
                  className="group block space-y-1 rounded-md px-0.5 py-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  title={`${def.n}. ${def.title}: ${STAGE_STATUS_META[status].label}`}
                >
                  <Segment status={status} />
                  <span className={cn("flex min-w-0 items-center gap-1 text-[11px] leading-tight", isCurrent ? "font-medium text-foreground" : "text-muted-foreground group-hover:text-foreground")}>
                    <span className="font-mono tabular-nums">{def.n}</span>
                    <span className="truncate">{def.title}</span>
                  </span>
                  <span className="sr-only">{STAGE_STATUS_META[status].label}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
    );
  }

  return (
    <nav aria-label="Stages" className={cn("@container min-w-0", className)}>
      {/* Two columns on phones (the fifth card spans both) so the pipeline stays one glance tall. */}
      <ol className="grid grid-cols-2 gap-2 @4xl:grid-cols-5">
        {STAGES.map((def) => {
          const view = stages[def.id];
          const status = view?.status ?? "locked";
          const isCurrent = !done && def.id === current;
          return (
            <li key={def.id} className="min-w-0 last:col-span-2 @4xl:last:col-span-1">
              <Link
                href={`/projects/${projectId}/${def.id}`}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,.04)] transition-shadow duration-150 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:border dark:border-border",
                  isCurrent && "ring-2 ring-primary",
                  (status === "locked" || status === "not_started") && !isCurrent && "bg-card/60",
                )}
              >
                {HATCHED.has(status) ? <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1.5", SEGMENT_COLOR[status])} style={HATCH_STYLE} /> : null}
                {status === "approved" ? <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1.5 bg-current", SEGMENT_COLOR[status])} /> : null}
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">0{def.n}</span>
                  <span className="inline-flex size-7 items-center justify-center rounded-full bg-muted text-foreground">
                    <StageIcon stage={def.id} className="size-4" />
                  </span>
                  <span className="flex-1" />
                  {isCurrent ? <span className="text-[10.5px] font-medium tracking-[0.12em] text-primary uppercase">Current</span> : null}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-medium">{def.title}</div>
                  <div className="text-xs text-muted-foreground">{def.owner}</div>
                </div>
                {/* The metric has its own line (reserved when empty) so every card's pill sits at the same height. */}
                <div className="mt-auto space-y-1.5">
                  <StageStatusPill status={status} />
                  <p className="min-h-4 truncate text-xs leading-4 text-muted-foreground tabular-nums">{view?.metric ?? ""}</p>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
