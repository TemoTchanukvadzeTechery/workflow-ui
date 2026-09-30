"use client";

/**
 * Portfolio pipeline: one column per stage with the number of projects in it right now, and a
 * stacked bar of those same projects by the stage's status (needs input, awaiting approval, in
 * progress hatched; not started outlined), so the number and the bar measure one thing. How many
 * projects already passed the stage is a quiet line underneath. Each column opens the project
 * list filtered to that stage. On a narrow card the columns become rows. The legend lists only
 * the statuses on screen.
 */
import Link from "next/link";
import type { CSSProperties } from "react";
import { SectionCard, StageIcon, toneClasses } from "@/components/common";
import { STAGES, type DashboardData, type ProjectSummary, type StageId, type StageStatus } from "@/lib/delivery/types";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/weft/labels";

type PartKey = "needsInput" | "inReview" | "inProgress" | "failed" | "notStarted";

interface Part {
  key: PartKey;
  label: string;
  tone: Tone;
  hatched: boolean;
  n: number;
}

const LEGEND: Array<Omit<Part, "n">> = [
  { key: "needsInput", label: "Needs input", tone: "attention", hatched: true },
  { key: "inReview", label: "Awaiting approval", tone: "review", hatched: true },
  { key: "inProgress", label: "In progress", tone: "running", hatched: true },
  { key: "failed", label: "Failed", tone: "danger", hatched: false },
  { key: "notStarted", label: "Not started", tone: "neutral", hatched: false },
];

/** A current stage's status as a bar part (a stage that is current is never locked or approved for long). */
function partOf(status: StageStatus | undefined): PartKey {
  switch (status) {
    case "needs_input":
      return "needsInput";
    case "in_review":
      return "inReview";
    case "in_progress":
      return "inProgress";
    case "failed":
      return "failed";
    default:
      return "notStarted";
  }
}

function partsOf(projects: ProjectSummary[], stage: StageId): Part[] {
  const n: Record<PartKey, number> = { needsInput: 0, inReview: 0, inProgress: 0, failed: 0, notStarted: 0 };
  for (const p of projects) if (!p.done && p.currentStage === stage) n[partOf(p.stageStatuses[stage])]++;
  return LEGEND.map((l) => ({ ...l, n: n[l.key] }));
}

function Swatch({ part, className }: { part: Omit<Part, "n">; className?: string }) {
  const t = toneClasses(part.tone);
  if (part.key === "notStarted") return <span aria-hidden className={cn("inline-block rounded-[3px] border border-dashed border-foreground/25", className)} />;
  return <span aria-hidden className={cn("inline-block rounded-[3px]", part.hatched ? cn("hatch", t.bg, t.text) : t.solid, className)} />;
}

function Fill({ part, style, className }: { part: Part; style?: CSSProperties; className?: string }) {
  const t = toneClasses(part.tone);
  const cls = part.key === "notStarted" ? "border border-dashed border-foreground/25 bg-transparent" : part.hatched ? cn("hatch", t.bg, t.text) : t.solid;
  return <span aria-hidden title={`${part.label}: ${part.n}`} className={cn("block min-h-0 min-w-0 rounded-lg", cls, className)} style={style} />;
}

function describe(title: string, here: number, parts: Part[], passed: number): string {
  const bits = parts.filter((p) => p.n > 0).map((p) => `${p.n} ${p.label.toLowerCase()}`);
  return `${title}: ${plural(here, "project")} here now${bits.length ? ` (${bits.join(", ")})` : ""}; ${passed} passed this stage. Show the projects here.`;
}

export interface PipelineCardProps {
  pipeline: DashboardData["pipeline"];
  /** Every project; the columns count the ones currently in each stage (not done). */
  projects: ProjectSummary[];
  /** Highlight one column, e.g. the stage filter the user came from. */
  selected?: StageId;
  className?: string;
}

export function PipelineCard({ pipeline, projects, selected, className }: PipelineCardProps) {
  const columns = STAGES.map((def) => {
    const parts = partsOf(projects, def.id);
    const here = parts.reduce((sum, p) => sum + p.n, 0);
    const passed = pipeline.find((r) => r.stage === def.id)?.approved ?? 0;
    return { def, parts, here, passed };
  });
  const max = Math.max(1, ...columns.map((c) => c.here));
  const used = LEGEND.filter((l) => columns.some((c) => c.parts.some((p) => p.key === l.key && p.n > 0)));

  return (
    <SectionCard
      kicker="Portfolio"
      title="Pipeline"
      description="The projects in each stage right now, by status. Pick a stage to see its projects."
      className={cn("@container", className)}
      bodyClassName="flex flex-col"
    >
      <ol className="grid flex-1 grid-cols-1 gap-2 @2xl:grid-cols-5 @2xl:gap-3">
        {columns.map(({ def, parts, here, passed }) => {
          const visible = parts.filter((p) => p.n > 0);
          const on = selected === def.id;
          return (
            <li key={def.id} className="min-w-0">
              <Link
                href={`/projects?stage=${def.id}`}
                aria-label={describe(def.title, here, parts, passed)}
                className={cn(
                  "group flex h-full min-w-0 items-center gap-3 rounded-xl p-3 transition-colors duration-150 hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none @2xl:flex-col @2xl:items-stretch @2xl:gap-3",
                  on ? "bg-primary-soft ring-1 ring-primary/40" : "bg-muted/35",
                )}
              >
                {/* Identity: icon beside the title in rows, above it in columns. */}
                <div className="flex w-36 min-w-0 shrink-0 items-center gap-2 @2xl:w-auto @2xl:flex-col @2xl:items-stretch">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-card text-foreground shadow-card">
                      <StageIcon stage={def.id} />
                    </span>
                    <span className="hidden font-mono text-[10.5px] text-muted-foreground tabular-nums @2xl:inline">0{def.n}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] leading-5 font-medium text-foreground">{def.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{def.owner}</div>
                  </div>
                </div>

                {/* Count */}
                <div className="flex w-12 shrink-0 flex-col items-end @2xl:w-auto @2xl:items-start">
                  <span className="text-[28px] leading-8 font-normal tracking-[-0.03em] text-foreground @2xl:text-[40px] @2xl:leading-[44px]">{here}</span>
                  <span className="text-[11px] leading-4 whitespace-nowrap text-muted-foreground">here now</span>
                </div>

                {/* Horizontal bar (rows) */}
                <div className="flex h-3 min-w-0 flex-1 gap-[2px] @2xl:hidden">
                  {here === 0 ? <span className="block h-full flex-1 rounded-md border border-dashed border-foreground/15" /> : visible.map((p) => <Fill key={p.key} part={p} style={{ flexGrow: p.n, flexBasis: 0 }} />)}
                  <span className="block" style={{ flexGrow: max - here, flexBasis: 0 }} />
                </div>

                {/* Vertical bar (columns): height follows how many projects are in the stage now. */}
                <div className="hidden min-h-32 flex-1 flex-col justify-end @2xl:flex">
                  <div className="flex flex-col-reverse gap-[2px]" style={{ height: `${(here / max) * 100}%` }}>
                    {here === 0 ? <span className="block h-2 rounded-md border border-dashed border-foreground/15" /> : visible.map((p) => <Fill key={p.key} part={p} style={{ flexGrow: p.n, flexBasis: 0 }} className="min-h-2" />)}
                  </div>
                </div>

                <p className="hidden space-y-0.5 text-[11px] leading-4 text-muted-foreground @2xl:block">
                  <span className="block">{here === 0 ? "No project here now" : visible.map((p) => `${p.n} ${p.label.toLowerCase()}`).join(" · ")}</span>
                  <span className="block">{passed} passed</span>
                </p>
              </Link>
            </li>
          );
        })}
      </ol>
      {used.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground" aria-label="Legend">
          {used.map((l) => (
            <li key={l.key} className="inline-flex items-center gap-1.5">
              <Swatch part={l} className="size-2.5" />
              {l.label}
            </li>
          ))}
        </ul>
      ) : null}
    </SectionCard>
  );
}
