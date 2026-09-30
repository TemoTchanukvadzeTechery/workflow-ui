"use client";

/**
 * One project as a bento card: identity, health (and why, when not on track), the 5-stage bar,
 * the current stage, next step, waiting and spend. The whole card is a link, so the health
 * reason is text here rather than a popover.
 */
import { ArrowRight, Hand } from "lucide-react";
import Link from "next/link";
import { HealthPill, healthReasonText, Money, RelativeTime, SegmentBar, stageSegments, StatusPill } from "@/components/common";
import type { ProjectSummary } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { projectStatusMeta } from "@/lib/weft/labels";
import { StageChip } from "./StageChip";

export function ProjectCard({ project: p, className }: { project: ProjectSummary; className?: string }) {
  const status = projectStatusMeta(p);
  return (
    <Link
      href={`/projects/${p.id}`}
      className={cn(
        "card-surface group flex min-w-0 flex-col gap-4 rounded-2xl p-5 transition-shadow duration-150 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[11px] text-muted-foreground">{p.key}</div>
          <h3 className="mt-0.5 line-clamp-2 text-[16px] leading-snug font-medium text-foreground group-hover:underline group-hover:underline-offset-2">{p.name}</h3>
        </div>
        {!p.done ? <HealthPill health={p.health} reason={p.healthReason} interactive={false} /> : null}
      </div>
      {p.summary ? <p className="line-clamp-2 text-[13px] text-muted-foreground">{p.summary}</p> : null}
      {!p.done && p.health !== "on_track" ? <p className={cn("-mt-2 line-clamp-2 text-xs", p.health === "off_track" ? "text-status-danger-fg" : "text-status-attention-fg")}>{healthReasonText(p.health, p.healthReason)}</p> : null}

      {/* The stage chip below names the current stage, so the bar needs no per-stage labels. */}
      <SegmentBar size="md" segments={stageSegments(p.stageStatuses)} />

      <div className="flex flex-wrap items-center gap-2">
        {!p.done ? <StageChip stage={p.currentStage} numbered /> : null}
        <StatusPill {...status} size="sm" />
      </div>

      {p.nextStep ? (
        <p className="flex items-start gap-1.5 text-[13px] leading-snug text-foreground">
          <ArrowRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <span className="line-clamp-2">{p.nextStep}</span>
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
        <span className={cn("inline-flex items-center gap-1", p.waitingCount > 0 && "font-medium text-status-attention-fg")}>
          <Hand aria-hidden className="size-3.5" />
          {p.waitingCount === 0 ? "Nothing waiting" : `${p.waitingCount} waiting on people`}
        </span>
        <Money usd={p.spendUsd} />
        <RelativeTime at={p.updatedAt} prefix="updated" className="ml-auto" />
      </div>
    </Link>
  );
}
