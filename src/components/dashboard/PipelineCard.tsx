"use client";

/**
 * Portfolio pipeline as the reference's Payments funnel: one column per stage with how many
 * projects reached it (a cumulative funnel, so it can only fall from left to right). The active
 * column starts on the stage where most things wait on people; hovering, focusing or arrowing
 * moves it, and its glass readout says how many projects are there now, awaiting approval and
 * needing input. Choosing a column opens the project list filtered to that stage. A prompt band
 * (`footer`) overlaps the bottom of the bars.
 */
import { ArrowUpRight, FolderKanban, Inbox, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { SectionCard } from "@/components/common";
import { FunnelColumns, useElementSize, type FunnelColumn } from "@/components/viz";
import { STAGES, type DashboardData, type ProjectSummary, type StageId } from "@/lib/delivery/types";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CardMenu } from "./CardMenu";

export interface PipelineCardProps {
  pipeline: DashboardData["pipeline"];
  /** Every project; "here now" counts the ones currently in each stage (not done). */
  projects: ProjectSummary[];
  /** Rendered at the bottom of the card, overlapping the bars (the prompt band). */
  footer?: ReactNode;
  /** Height of the bar area in px (default 296). */
  height?: number;
  className?: string;
}

interface StageFigures {
  stage: StageId;
  reached: number;
  here: number;
  awaiting: number;
  needInput: number;
}

function figures(pipeline: DashboardData["pipeline"], projects: ProjectSummary[]): StageFigures[] {
  return STAGES.map((def) => {
    const row = pipeline.find((r) => r.stage === def.id);
    return {
      stage: def.id,
      reached: row?.total ?? 0,
      here: projects.filter((p) => !p.done && p.currentStage === def.id).length,
      awaiting: row?.inReview ?? 0,
      needInput: row?.needsInput ?? 0,
    };
  });
}

/** Integer ticks for a count axis: about three, never fractional. */
function countTicks(max: number): Array<{ value: number; label: string }> {
  if (max <= 1) return [];
  const step = max <= 4 ? 1 : max <= 8 ? 2 : max <= 20 ? 5 : Math.ceil(max / 3 / 10) * 10;
  const out: Array<{ value: number; label: string }> = [];
  for (let v = step; v <= max; v += step) out.push({ value: v, label: String(v) });
  return out;
}

export function PipelineCard({ pipeline, projects, footer, height = 296, className }: PipelineCardProps) {
  const router = useRouter();
  const [boxRef, box] = useElementSize<HTMLDivElement>();
  // Phones get a shorter funnel, so the card does not fill the whole screen.
  const narrow = box.width > 0 && box.width < 520;
  const barHeight = narrow ? Math.min(height, 200) : height;
  const rows = figures(pipeline, projects);
  const byStage = new Map(rows.map((r) => [r.stage, r]));
  // Start on the stage with the most waiting on people (ties: the earliest), else the first.
  const busiest = rows.reduce<StageFigures | undefined>((best, r) => (r.awaiting + r.needInput > (best ? best.awaiting + best.needInput : 0) ? r : best), undefined);
  const max = Math.max(1, ...rows.map((r) => r.reached));

  const columns: FunnelColumn[] = rows.map((r) => ({
    key: r.stage,
    // Short stage names ("BRD", "Build") where the full titles would truncate.
    label: (narrow ? STAGES.find((s) => s.id === r.stage)?.short : STAGES.find((s) => s.id === r.stage)?.title) ?? r.stage,
    value: r.reached,
    display: String(r.reached),
    hint: `${plural(r.reached, "project")} reached it; ${r.here} here now, ${r.awaiting} awaiting approval, ${r.needInput} need input`,
  }));

  return (
    <SectionCard
      title="Pipeline"
      cardMenu={
        <CardMenu
          label="Pipeline options"
          items={[
            { label: "All projects", href: "/projects", icon: FolderKanban },
            { label: "Open the inbox", href: "/inbox", icon: Inbox },
            { label: "New project", href: "/projects/new", icon: Plus },
            { label: "Agent runs", href: "/runs", icon: ArrowUpRight },
          ]}
        />
      }
      className={cn("overflow-hidden", className)}
      bodyClassName={cn("flex flex-col justify-end", footer ? "pb-1 sm:pb-1" : undefined)}
    >
      <div ref={boxRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <FunnelColumns
        columns={columns}
        defaultActiveKey={busiest?.stage}
        max={max}
        height={barHeight}
        fill
        axis={countTicks(max)}
        ariaLabel="Projects that reached each stage"
        onSelect={(key) => router.push(`/projects?stage=${key}`)}
        tooltip={(col) => {
          const r = byStage.get(col.key as StageId);
          if (!r) return [];
          return [
            { value: r.here, label: "here now", valueFirst: true },
            { value: r.awaiting, label: "awaiting approval", valueFirst: true },
            { value: r.needInput, label: r.needInput === 1 ? "needs input" : "need input", valueFirst: true },
          ];
        }}
      />
      </div>
      {/* The band sits 4px inside the card's sides and bottom, so it reads as the card's base. */}
      {footer ? <div className="relative z-30 -mx-4 -mt-8 sm:-mx-6 sm:-mt-14">{footer}</div> : null}
    </SectionCard>
  );
}
