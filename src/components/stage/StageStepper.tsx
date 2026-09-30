"use client";

/**
 * The five-stage pipeline. Large: five reference cards (number, icon, title, owner, status, metric,
 * and a striped status bar), the current one ringed in brand blue; a done project has no current
 * stage. Compact: a striped segmented bar with stage titles. Stages carry no color of their own;
 * color always means status.
 */
import Link from "next/link";
import { StageIcon, toneClasses } from "@/components/common";
import { STAGES, type StageId, type StageStatus, type StageView } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/weft/labels";
import { STAGE_STATUS_META, StageStatusPill } from "../hitl/bits";

/** Hatch for partial/in-progress: 135deg stripes of currentColor at ~35% opacity. */
export const HATCH_STYLE = { backgroundImage: "repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 6px)", opacity: 0.35 } as const;

const HATCHED: ReadonlySet<StageStatus> = new Set<StageStatus>(["in_progress", "needs_input", "in_review"]);


export interface StageStepperProps {
  projectId: string;
  stages: Record<StageId, StageView>;
  current: StageId;
  /** The project is done: no stage is "current" any more. */
  done?: boolean;
  variant: "large" | "compact";
  className?: string;
}

/** Tone of the striped segment per status; locked / not started stay an empty track. */
const SEGMENT_TONE: Partial<Record<StageStatus, Tone>> = {
  in_progress: "running",
  needs_input: "attention",
  in_review: "review",
  approved: "success",
  failed: "danger",
};

function Segment({ status, size = "sm" }: { status: StageStatus; size?: "sm" | "md" }) {
  const tone = SEGMENT_TONE[status];
  return (
    <span aria-hidden className={cn("bar-track relative block overflow-hidden rounded-full", size === "md" ? "h-2.5" : "h-1.5")}>
      {tone ? <span className={cn("absolute inset-0 rounded-full", toneClasses(tone).stripe, HATCHED.has(status) && "opacity-60")} /> : null}
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
                  className="group block space-y-1.5 rounded-[10px] px-0.5 py-1 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  title={`${def.n}. ${def.title}: ${STAGE_STATUS_META[status].label}`}
                >
                  <Segment status={status} />
                  <span className={cn("flex min-w-0 items-center gap-1 text-xs leading-tight", isCurrent ? "font-medium text-heading" : "text-muted-foreground group-hover:text-heading")}>
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
      <ol className="grid grid-cols-2 gap-3 @4xl:grid-cols-5 @4xl:gap-4">
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
                  "card-surface relative flex h-full flex-col gap-4 overflow-hidden rounded-[24px] p-4 transition-shadow duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none @4xl:p-5",
                  "hover:shadow-[var(--card-edge),0_1px_2px_rgb(0_0_0/0.04),0_20px_40px_-18px_rgb(0_0_0/0.16)]",
                  isCurrent && "ring-2 ring-primary",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="circle-btn size-9 text-heading">
                    <StageIcon stage={def.id} className="size-4" />
                  </span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">0{def.n}</span>
                  <span className="flex-1" />
                  {isCurrent ? <span className="kicker text-primary">Current</span> : null}
                </div>
                <div className="min-w-0">
                  <div className={cn("truncate text-[17px] leading-6 font-medium tracking-[-0.015em]", status === "locked" && !isCurrent ? "text-muted-foreground" : "text-heading")}>{def.title}</div>
                  <div className="text-[13px] text-muted-foreground">{def.owner}</div>
                </div>
                {/* The metric has its own line (reserved when empty) so every card's pill sits at the same height. */}
                <div className="mt-auto space-y-2.5">
                  <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
                    <StageStatusPill status={status} />
                    <p className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">{view?.metric ?? ""}</p>
                  </div>
                  <Segment status={status} size="md" />
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
