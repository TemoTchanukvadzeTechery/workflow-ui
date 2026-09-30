"use client";

/**
 * Agent spend, built like the reference's Gross Volume: the period's total as a hero number with
 * a delta chip against the previous period of the same length, a rule, then one striped bar per
 * stage that runs agents (share of the total, value right-aligned).
 */
import { Activity, FolderKanban } from "lucide-react";
import { FloatingChip, SectionCard, StripedBar } from "@/components/common";
import { Skeleton } from "@/components/ui/skeleton";
import { stageDef, type StageId } from "@/lib/delivery/types";
import { formatUsd, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CardMenu } from "./CardMenu";
import { percentChange, type HomeMetrics } from "./metrics";

/** Series colors (STYLE.md 4): stages have no color of their own, these only tell the bars apart. */
const STAGE_COLOR: Partial<Record<StageId, string>> = {
  requirements: "var(--status-success-solid)",
  architecture: "var(--status-running-solid)",
  implementation: "var(--chart-pink)",
  qa: "var(--status-review-solid)",
};

export function AgentSpendCard({ metrics, className }: { metrics?: HomeMetrics; className?: string }) {
  const change = metrics ? percentChange(metrics.spend, metrics.prevSpend) : undefined;
  return (
    <SectionCard
      title="Agent spend"
      cardMenu={
        <CardMenu
          label="Agent spend options"
          items={[
            { label: "Agent runs", href: "/runs", icon: Activity },
            { label: "Spend by project", href: "/projects", icon: FolderKanban },
          ]}
        />
      }
      className={className}
      bodyClassName="flex flex-col"
    >
      {!metrics ? (
        <div aria-busy="true" aria-label="Loading spend" className="flex flex-col gap-6 pt-4">
          <Skeleton className="h-16 w-56" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-3 pb-6 sm:pt-5 sm:pb-7">
            <span className="text-[52px] leading-none font-normal tracking-[-0.045em] text-heading tabular-nums sm:text-[64px] xl:text-[72px]">{formatUsd(metrics.spend)}</span>
            {change !== undefined ? (
              <FloatingChip
                tone="running"
                delta={change >= 0 ? "up" : "down"}
                value={`${Math.abs(change)}%`}
                title={`${change >= 0 ? "Up" : "Down"} ${Math.abs(change)}% on the previous ${metrics.period} days (${formatUsd(metrics.prevSpend)})`}
              />
            ) : null}
          </div>
          <ul className="flex flex-col gap-5 border-t border-rule pt-5 sm:gap-6 sm:pt-6">
            {metrics.spendByStage.map((row) => {
              const title = stageDef(row.stage).title;
              return (
                <li key={row.stage} className="flex flex-col gap-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[15px] leading-5 text-muted-foreground sm:text-base">{title}</span>
                    <span className="shrink-0 text-[15px] leading-5 text-heading tabular-nums sm:text-base">{formatUsd(row.usd)}</span>
                  </div>
                  <StripedBar
                    value={row.usd}
                    max={Math.max(metrics.spend, 0.01)}
                    color={STAGE_COLOR[row.stage]}
                    label={`${title}: ${formatUsd(row.usd)} of ${formatUsd(metrics.spend)}, ${plural(row.runs, "run")}`}
                    className={cn(row.usd === 0 && "opacity-70")}
                  />
                </li>
              );
            })}
          </ul>
          <p className="mt-auto pt-5 text-[13px] leading-5 text-muted-foreground">
            {plural(metrics.runs, "agent run")} in the last {metrics.period} days · {formatUsd(metrics.prevSpend)} the {metrics.period} days before
          </p>
        </>
      )}
    </SectionCard>
  );
}
