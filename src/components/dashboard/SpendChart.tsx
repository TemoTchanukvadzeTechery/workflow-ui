"use client";

/**
 * 14-day agent spend and run counts as two small multiples on one shared day axis (never a dual
 * axis). Hovering or arrowing through either chart shows one tooltip with both values for that
 * day; a Table toggle gives the same numbers without the chart.
 */
import { BarChart3, Table2 } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { SectionCard } from "@/components/common";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { DashboardData } from "@/lib/delivery/types";
import { formatUsd, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

type Point = DashboardData["spendSeries"][number];

const config = {
  usd: { label: "Spend", color: "var(--chart-1)" },
  runs: { label: "Agent runs", color: "var(--chart-2)" },
} satisfies ChartConfig;

/** "2026-09-16" is a local calendar day. */
function parseDay(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
const DAY_SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const DAY_LONG = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
const dayShort = (date: string) => DAY_SHORT.format(parseDay(date));
const dayLong = (date: string) => DAY_LONG.format(parseDay(date));

function DayTooltip({ active, payload }: TooltipContentProps<number, string>) {
  const p = payload?.[0]?.payload as Point | undefined;
  if (!active || !p) return null;
  return (
    <div className="grid min-w-36 gap-1.5 rounded-lg border border-border/60 bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-lg">
      <div className="text-muted-foreground">{dayLong(p.date)}</div>
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: "var(--color-usd)" }} />
        <span className="font-medium text-foreground tabular-nums">{formatUsd(p.usd)}</span>
        <span className="text-muted-foreground">spend</span>
      </div>
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: "var(--color-runs)" }} />
        <span className="font-medium text-foreground tabular-nums">{p.runs}</span>
        <span className="text-muted-foreground">{p.runs === 1 ? "agent run" : "agent runs"}</span>
      </div>
    </div>
  );
}

const AXIS_TICK = { fontSize: 11 };

export function SpendChart({ series, className }: { series: DashboardData["spendSeries"]; className?: string }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const totalUsd = series.reduce((s, p) => s + p.usd, 0);
  const totalRuns = series.reduce((s, p) => s + p.runs, 0);
  const peak = series.reduce<Point | undefined>((best, p) => (!best || p.usd > best.usd ? p : best), undefined);

  return (
    <SectionCard
      kicker="Last 14 days"
      title="Agent spend and runs"
      description={
        <span>
          <span className="font-medium text-foreground tabular-nums">{formatUsd(totalUsd)}</span> across {plural(totalRuns, "agent run")}
          {peak && peak.usd > 0 ? <span className="hidden sm:inline"> · busiest day {dayShort(peak.date)} ({formatUsd(peak.usd)})</span> : null}
        </span>
      }
      actions={
        <ToggleGroup type="single" size="sm" variant="outline" value={view} onValueChange={(v) => v && setView(v as "chart" | "table")} aria-label="Show as">
          <ToggleGroupItem value="chart" aria-label="Chart view" className="px-2">
            <BarChart3 aria-hidden />
          </ToggleGroupItem>
          <ToggleGroupItem value="table" aria-label="Table view" className="px-2">
            <Table2 aria-hidden />
          </ToggleGroupItem>
        </ToggleGroup>
      }
      className={className}
    >
      {view === "chart" ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-[2px] bg-chart-1" />
              Spend per day
            </span>
          </div>
          <ChartContainer config={config} className="aspect-auto h-[150px] w-full" initialDimension={{ width: 600, height: 150 }}>
            <BarChart data={series} syncId="home-spend" margin={{ top: 6, right: 0, bottom: 0, left: 0 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" hide />
              <YAxis width={44} tickLine={false} axisLine={false} tick={AXIS_TICK} tickCount={4} allowDecimals={false} tickFormatter={(v: number) => `$${v}`} />
              <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={(props) => <DayTooltip {...(props as TooltipContentProps<number, string>)} />} />
              <Bar dataKey="usd" name="Spend" fill="var(--color-usd)" radius={[4, 4, 0, 0]} maxBarSize={24} activeBar={{ fillOpacity: 0.8 }} />
            </BarChart>
          </ChartContainer>
          <div className="flex items-center justify-between pt-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-[2px] bg-chart-2" />
              Agent runs per day
            </span>
          </div>
          <ChartContainer config={config} className="aspect-auto h-[92px] w-full" initialDimension={{ width: 600, height: 92 }}>
            <BarChart data={series} syncId="home-spend" margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tick={AXIS_TICK} tickMargin={6} minTickGap={16} tickFormatter={dayShort} />
              <YAxis width={44} tickLine={false} axisLine={false} tick={AXIS_TICK} tickCount={3} allowDecimals={false} />
              <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={() => null} />
              <Bar dataKey="runs" name="Agent runs" fill="var(--color-runs)" radius={[4, 4, 0, 0]} maxBarSize={24} activeBar={{ fillOpacity: 0.8 }} />
            </BarChart>
          </ChartContainer>
        </div>
      ) : (
        <div className="relative max-h-[266px] overflow-y-auto rounded-xl border">
          <table className="w-full text-[13px]">
            <caption className="sr-only">Agent spend and runs per day, last 14 days</caption>
            <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="px-3 py-2 text-left font-medium">Day</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Spend</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Agent runs</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[...series].reverse().map((p) => (
                <tr key={p.date} className={cn(p.runs === 0 && "text-muted-foreground")}>
                  <th scope="row" className="px-3 py-1.5 text-left font-normal">{dayLong(p.date)}</th>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatUsd(p.usd)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.runs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
