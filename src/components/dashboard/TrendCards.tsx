"use client";

/**
 * Home's second row, in the reference's Retention / Transactions / Customers shapes: agent spend
 * per day as a step chart with the peak marked, and two dot-matrix cards (agent runs and human
 * decisions per weekday) with a big number, the peak weekday and the change on the last period.
 */
import { format } from "date-fns";
import type { ReactNode } from "react";
import { SectionCard } from "@/components/common";
import { Skeleton } from "@/components/ui/skeleton";
import { DotMatrix, StepAreaChart } from "@/components/viz";
import { formatUsd } from "@/lib/format";
import { CardMenu } from "./CardMenu";
import { signed, WEEKDAYS, type HomeMetrics } from "./metrics";

/** About five evenly spread day labels ("Sep 17") under the step chart. */
function dayLabels(days: HomeMetrics["days"], want = 5): string[] {
  if (days.length <= want) return days.map((d) => format(d.at, "MMM d"));
  const step = (days.length - 1) / (want - 1);
  return Array.from({ length: want }, (_, i) => format(days[Math.round(i * step)].at, "MMM d"));
}

export function SpendPerDayCard({ metrics, className }: { metrics?: HomeMetrics; className?: string }) {
  const days = metrics?.days ?? [];
  const peak = days.reduce((best, d, i) => (d.usd > (days[best]?.usd ?? 0) ? i : best), 0);
  const hasSpend = days.some((d) => d.usd > 0);
  return (
    <SectionCard title="Spend per day" cardMenu={<CardMenu href="/runs" label="Open agent runs" />} className={className} bodyClassName="flex flex-col justify-end">
      {!metrics ? (
        <Skeleton className="h-[250px] w-full" />
      ) : (
        <StepAreaChart
          data={days.map((d) => ({ label: format(d.at, "EEE, MMM d"), value: d.usd }))}
          highlightIndex={hasSpend ? peak : undefined}
          chipLabel={hasSpend ? formatUsd(days[peak].usd) : undefined}
          xLabels={dayLabels(days)}
          height={252}
          formatValue={(v) => formatUsd(v)}
          ariaLabel={`Agent spend per day, last ${metrics.period} days`}
        />
      )}
    </SectionCard>
  );
}

export interface DotsCardProps {
  title: string;
  /** The big number (the period's total). */
  total?: number;
  /** Per weekday, Monday first. */
  columns?: number[];
  /** Change on the previous period of the same length. */
  delta?: number;
  tone: "green" | "blue";
  /** Chip prefix over the peak weekday: "Peak", "Highest". */
  peakLabel: string;
  /** Noun for the screen-reader list: "runs". */
  unit: string;
  menu?: ReactNode;
  className?: string;
}

export function DotsCard({ title, total, columns, delta, tone, peakLabel, unit, menu, className }: DotsCardProps) {
  const loading = total === undefined || !columns;
  return (
    <SectionCard title={title} cardMenu={menu} className={className} bodyClassName="flex flex-col justify-end">
      {loading ? (
        <div className="flex items-end justify-between gap-6" aria-busy="true" aria-label={`Loading ${title.toLowerCase()}`}>
          <Skeleton className="h-12 w-24" />
          <Skeleton className="h-14 w-48" />
          <Skeleton className="h-10 w-20" />
        </div>
      ) : (
        <div className="@container">
          {/* Narrow cards: number and delta on one line, the dots under them. */}
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-x-4 gap-y-5 @[30rem]:grid-cols-[auto_minmax(0,1fr)_auto] @[30rem]:gap-x-6">
            <span className="pb-0.5 text-[44px] leading-none font-normal tracking-[-0.04em] text-heading tabular-nums @[30rem]:text-[52px]">{total}</span>
            <div className="order-last col-span-2 flex min-w-0 justify-center @[30rem]:order-none @[30rem]:col-span-1">
              <DotMatrix columns={columns} labels={[...WEEKDAYS]} peakLabel={peakLabel} tone={tone} unit={unit} dotSize={11} className="max-w-full" />
            </div>
            <div className="flex flex-col items-end gap-2 pb-0.5 text-right">
              <span className="text-[13px] leading-5 whitespace-nowrap text-muted-foreground @[30rem]:text-[15px]">vs last period</span>
              <span className="text-[20px] leading-6 text-heading tabular-nums @[30rem]:text-[22px] @[30rem]:leading-7">{delta === undefined ? "–" : signed(delta)}</span>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
