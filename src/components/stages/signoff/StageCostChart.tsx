"use client";

/**
 * Time and cost per stage: one small bar chart (switch between agent cost and wall-clock time)
 * over the five stages, with the same numbers in a table underneath.
 */
import { Clock3, DollarSign } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { SectionCard } from "@/components/common";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useNow } from "@/hooks/use-now";
import { useRuns } from "@/lib/api/queries";
import type { ProjectBundle } from "@/lib/delivery/types";
import { formatDuration, formatUsd, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { stageTimes } from "./model";

type Metric = "cost" | "time";

interface Point {
  label: string;
  title: string;
  n: number;
  name: string;
  usd: number | null;
  hours: number | null;
  ms?: number;
  runs: number;
  open: boolean;
}

const config = {
  usd: { label: "Agent cost", color: "var(--chart-1)" },
  hours: { label: "Time", color: "var(--chart-2)" },
} satisfies ChartConfig;

const AXIS_TICK = { fontSize: 11 };

function hoursLabel(h: number): string {
  if (h >= 48) return `${Math.round(h / 24)}d`;
  return `${Math.round(h)}h`;
}

function PointTooltip({ active, payload }: TooltipContentProps<number, string>) {
  const p = payload?.[0]?.payload as Point | undefined;
  if (!active || !p) return null;
  return (
    <div className="grid min-w-40 gap-1 rounded-lg border border-border/60 bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-lg">
      <div className="font-medium text-foreground">{p.title}</div>
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Agent cost</span>
        <span className="tabular-nums">{p.usd === null ? "-" : formatUsd(p.usd)}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Time</span>
        <span className="tabular-nums">{p.ms === undefined ? "-" : `${formatDuration(p.ms)}${p.open ? " so far" : ""}`}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Agent runs</span>
        <span className="tabular-nums">{p.runs}</span>
      </div>
    </div>
  );
}

export function StageCostChart({ bundle, className }: { bundle: ProjectBundle; className?: string }) {
  const [metric, setMetric] = useState<Metric>("cost");
  const now = useNow(60_000);
  const runsQ = useRuns({ limit: 1000 });
  const spendByRun = new Map((runsQ.data ?? []).map((r) => [r.runId, r.spend?.usd ?? 0]));
  const costKnown = !!runsQ.data;

  const data: Point[] = stageTimes(bundle, now).map((s) => {
    const usd = costKnown ? bundle.stages[s.stage].runs.reduce((sum, r) => sum + (spendByRun.get(r.runId) ?? 0), 0) : null;
    return { label: s.short, title: `Stage ${s.n} · ${s.title}`, n: s.n, name: s.title, usd: usd === null ? null : Math.round(usd * 100) / 100, hours: s.ms === undefined ? null : Math.round((s.ms / 3_600_000) * 10) / 10, ms: s.ms, runs: s.runs, open: s.open };
  });
  const totalMs = data.reduce((sum, p) => sum + (p.ms ?? 0), 0);
  const totalRuns = data.reduce((sum, p) => sum + p.runs, 0);

  return (
    <SectionCard
      density="dense"
      kicker="Time and cost"
      title="Per stage"
      description={
        <span>
          <span className="font-medium text-foreground tabular-nums">{formatUsd(bundle.spendUsd)}</span> agent cost · <span className="tabular-nums">{formatDuration(totalMs)}</span> end to end · {plural(totalRuns, "agent run")}
        </span>
      }
      actions={
        <ToggleGroup type="single" size="sm" variant="outline" value={metric} onValueChange={(v) => v && setMetric(v as Metric)} aria-label="Chart shows">
          <ToggleGroupItem value="cost" aria-label="Agent cost per stage" className="gap-1 px-2 text-xs">
            <DollarSign aria-hidden />
            <span className="hidden sm:inline">Cost</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="time" aria-label="Time per stage" className="gap-1 px-2 text-xs">
            <Clock3 aria-hidden />
            <span className="hidden sm:inline">Time</span>
          </ToggleGroupItem>
        </ToggleGroup>
      }
      className={className}
    >
      {metric === "cost" && runsQ.isPending ? (
        <Skeleton className="h-[140px] w-full rounded-xl" />
      ) : metric === "cost" && !costKnown ? (
        <p className="flex h-[140px] items-center justify-center rounded-xl border border-dashed text-[13px] text-muted-foreground">Run costs could not be loaded.</p>
      ) : (
        <ChartContainer config={config} className="aspect-auto h-[140px] w-full" initialDimension={{ width: 480, height: 140 }}>
          <BarChart data={data} margin={{ top: 6, right: 0, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} tickMargin={6} interval={0} />
            <YAxis
              width={40}
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              tickCount={4}
              allowDecimals={false}
              tickFormatter={(v: number) => (metric === "cost" ? `$${v}` : hoursLabel(v))}
            />
            <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={(props) => <PointTooltip {...(props as TooltipContentProps<number, string>)} />} />
            <Bar dataKey={metric === "cost" ? "usd" : "hours"} name={metric === "cost" ? "Agent cost" : "Time"} fill={metric === "cost" ? "var(--color-usd)" : "var(--color-hours)"} radius={[4, 4, 0, 0]} maxBarSize={36} activeBar={{ fillOpacity: 0.8 }} />
          </BarChart>
        </ChartContainer>
      )}
      <div className="relative mt-3 overflow-x-auto rounded-xl border">
        <table className="w-full text-[13px]">
          <caption className="sr-only">Time, agent cost and runs per stage</caption>
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-1.5 font-medium">
                Stage
              </th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium">
                Time
              </th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium">
                Cost
              </th>
              <th scope="col" className="hidden px-3 py-1.5 text-right font-medium sm:table-cell">
                Runs
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.label} className="border-t">
                <th scope="row" className="px-3 py-1.5 text-left font-normal">
                  <span className="text-muted-foreground tabular-nums">{p.n}</span> {p.name}
                </th>
                <td className={cn("px-3 py-1.5 text-right whitespace-nowrap tabular-nums", p.ms === undefined && "text-muted-foreground")}>
                  {p.ms === undefined ? "-" : formatDuration(p.ms)}
                  {p.open ? <span className="text-muted-foreground"> so far</span> : null}
                </td>
                <td className={cn("px-3 py-1.5 text-right whitespace-nowrap tabular-nums", (p.usd === null || p.usd === 0) && "text-muted-foreground")}>{p.usd === null ? "-" : formatUsd(p.usd)}</td>
                <td className="hidden px-3 py-1.5 text-right tabular-nums sm:table-cell">{p.runs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
