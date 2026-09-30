/**
 * Time and cost per stage, drawn like the reference's Gross Volume and Retention cards: the total
 * as a hero numeral with a floating chip, a step chart of the chosen metric (agent cost or
 * wall-clock time) over the five stages, and the same numbers in a table underneath.
 */
import { Clock3, DollarSign } from "lucide-react";
import { useState } from "react";
import { FloatingChip, SectionCard, SegmentedControl } from "@/components/common";
import { Skeleton } from "@/components/ui/skeleton";
import { StepAreaChart } from "@/components/viz";
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

  const values = data.map((p) => (metric === "cost" ? (p.usd ?? 0) : (p.ms ?? 0)));
  const peak = values.reduce((best, v, i) => (v > (values[best] ?? 0) ? i : best), 0);
  const fmt = (v: number) => (metric === "cost" ? formatUsd(v) : formatDuration(v));

  return (
    <SectionCard
      density="dense"
      title="Time and cost"
      description="Per stage, all agent runs"
      actions={
        <SegmentedControl
          size="sm"
          aria-label="Chart shows"
          value={metric}
          onValueChange={setMetric}
          items={[
            { value: "cost", label: <span className="hidden sm:inline">Cost</span>, icon: DollarSign, ariaLabel: "Agent cost per stage" },
            { value: "time", label: <span className="hidden sm:inline">Time</span>, icon: Clock3, ariaLabel: "Time per stage" },
          ]}
        />
      }
      className={className}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[44px] leading-none font-normal tracking-[-0.04em] text-heading tabular-nums sm:text-[52px]">{metric === "cost" ? formatUsd(bundle.spendUsd) : formatDuration(totalMs)}</span>
        <FloatingChip tone="running" label={metric === "cost" ? "Runs" : "Agent cost"} value={metric === "cost" ? plural(totalRuns, "run") : formatUsd(bundle.spendUsd)} />
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">{metric === "cost" ? `agent cost · ${formatDuration(totalMs)} end to end` : `end to end · ${plural(totalRuns, "agent run")}`}</p>

      <div className="mt-4 border-t border-rule pt-2">
        {metric === "cost" && runsQ.isPending ? (
          <Skeleton className="h-[180px] w-full rounded-[16px]" />
        ) : metric === "cost" && !costKnown ? (
          <p className="flex h-[180px] items-center justify-center rounded-[16px] border border-dashed border-circle-border text-sm text-muted-foreground">Run costs could not be loaded.</p>
        ) : (
          <StepAreaChart
            data={data.map((p, i) => ({ label: p.label, value: values[i] ?? 0 }))}
            highlightIndex={peak}
            chipLabel={`${data[peak]?.label ?? ""}: ${fmt(values[peak] ?? 0)}`}
            xLabels={data.map((p) => p.label)}
            height={190}
            formatValue={(v, i) => `${data[i]?.label ?? ""}: ${fmt(v)}`}
            ariaLabel={metric === "cost" ? "Agent cost per stage" : "Time per stage"}
          />
        )}
      </div>

      <div className="relative -mx-5 mt-4 overflow-x-auto border-t border-rule">
        <table className="w-full text-sm">
          <caption className="sr-only">Time, agent cost and runs per stage</caption>
          <thead className="text-left text-[13px] text-muted-foreground">
            <tr className="h-10 border-b border-rule">
              <th scope="col" className="px-5 py-2 font-normal">
                Stage
              </th>
              <th scope="col" className="px-3 py-2 text-right font-normal">
                Time
              </th>
              <th scope="col" className="px-3 py-2 text-right font-normal">
                Cost
              </th>
              <th scope="col" className="hidden px-5 py-2 text-right font-normal sm:table-cell">
                Runs
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {data.map((p) => (
              <tr key={p.label} className="h-11 transition-colors hover:bg-foreground/[0.025]">
                <th scope="row" className="px-5 py-2 text-left font-normal text-heading">
                  <span className="text-muted-foreground tabular-nums">{p.n}</span> {p.name}
                </th>
                <td className={cn("px-3 py-2 text-right whitespace-nowrap tabular-nums", p.ms === undefined && "text-muted-foreground")}>
                  {p.ms === undefined ? "-" : formatDuration(p.ms)}
                  {p.open ? <span className="text-muted-foreground"> so far</span> : null}
                </td>
                <td className={cn("px-3 py-2 text-right whitespace-nowrap tabular-nums", (p.usd === null || p.usd === 0) && "text-muted-foreground")}>{p.usd === null ? "-" : formatUsd(p.usd)}</td>
                <td className="hidden px-5 py-2 text-right tabular-nums sm:table-cell">{p.runs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
