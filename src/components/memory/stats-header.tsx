/**
 * The /memory overview's stats header card (plan A3): big note count, claims (with the proposed
 * sub-count, and a helper line while the vault has none), stale doc count, and a StripedBar
 * breakdown of notes by type — a genuine part-of-whole, in the Gross Volume card's idiom
 * (AgentSpendCard). Hook-free and server-compatible.
 */
import type { ReactNode } from "react";
import { SectionCard, StripedBar } from "@/components/common";
import { formatNumber, plural } from "@/lib/format";
import { MEMORY_NOTE_TYPES, type MemoryNoteType, type MemoryStats } from "@/lib/memory/types";
import { cn } from "@/lib/utils";
import { MEMORY_TYPE_META, MemoryTypeLabel } from "./status-meta";

/**
 * Series colors for the by-type breakdown (STYLE.md 4): note types have no color of their own,
 * these only tell labeled bars apart. The MP2 graph legend should reuse this map.
 */
export const MEMORY_TYPE_COLOR: Record<MemoryNoteType, string> = {
  system: "var(--chart-1)",
  document: "var(--chart-4)",
  project: "var(--chart-5)",
  team: "var(--chart-2)",
  stakeholder: "var(--chart-pink)",
  decision: "var(--chart-blue-light)",
  convention: "var(--chart-green-light)",
  kpi: "var(--chart-pink-stripe)",
  glossary: "var(--status-neutral-solid)",
  org: "var(--chart-blue)",
};

interface StatProps {
  label: string;
  value: number;
  /** Render the numeral in the inactive big-number gray (STYLE.md 2), e.g. a zero. */
  muted?: boolean;
  hint?: ReactNode;
}

/** One KPI column: muted label, a big regular-weight numeral (KPI scale), a muted hint line. */
function Stat({ label, value, muted, hint }: StatProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="text-[15px] leading-5 text-muted-foreground">{label}</div>
      <div className={cn("text-[40px] leading-none font-normal tracking-[-0.04em] tabular-nums sm:text-[44px]", muted ? "text-muted-numeral" : "text-heading")}>
        {formatNumber(value)}
      </div>
      {hint && <div className="max-w-60 text-[13px] leading-5 text-muted-foreground">{hint}</div>}
    </div>
  );
}

export interface MemoryStatsHeaderProps {
  stats: MemoryStats;
  className?: string;
}

export function MemoryStatsHeader({ stats, className }: MemoryStatsHeaderProps) {
  const breakdown = MEMORY_NOTE_TYPES.map((type) => ({ type, count: stats.byType[type] ?? 0 }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  return (
    <SectionCard className={className}>
      <div className="flex flex-col gap-8 xl:flex-row xl:items-start xl:justify-between xl:gap-12">
        <div className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 sm:gap-x-12">
          <Stat label="Notes" value={stats.notes} muted={stats.notes === 0} hint={plural(stats.edges, "connection")} />
          <Stat
            label="Claims"
            value={stats.claims}
            muted={stats.claims === 0}
            hint={
              stats.claims === 0
                ? "Claims appear when documents are signed off and memory updates are applied"
                : stats.proposedClaims > 0
                  ? `${plural(stats.proposedClaims, "proposed claim")} awaiting review`
                  : "None proposed"
            }
          />
          <Stat
            label="Stale documents"
            value={stats.staleDocs}
            muted={stats.staleDocs === 0}
            hint={stats.staleDocs === 0 ? "Every signed-off file matches its accepted version" : "Signed-off files that changed after acceptance"}
          />
        </div>
        <div className="flex w-full min-w-0 flex-col gap-3 xl:max-w-xl">
          <div className="text-[13px] leading-5 text-muted-foreground">Notes by type</div>
          {breakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {breakdown.map((r) => (
                <li key={r.type} className="grid grid-cols-[minmax(6.5rem,auto)_1fr_auto] items-center gap-3">
                  <MemoryTypeLabel type={r.type} className="text-[13px] text-muted-foreground" />
                  <StripedBar
                    value={r.count}
                    max={Math.max(stats.notes, 1)}
                    color={MEMORY_TYPE_COLOR[r.type]}
                    height={10}
                    label={`${MEMORY_TYPE_META[r.type].label}: ${r.count} of ${plural(stats.notes, "note")}`}
                  />
                  <span className="text-[13px] leading-5 text-heading tabular-nums">{formatNumber(r.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
