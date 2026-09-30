"use client";

/**
 * Live progress of a po-brd / architect-aad run: the weft phases (Preflight → Memory → Discover →
 * Draft N → Update memory) as labelled striped segments, discovery counters (sources fetched, searches
 * run, rejected commands), a spend ticker against the budget, elapsed time, and a compact ledger
 * of the latest steps. Everything re-renders from useRun, which live.ts invalidates over SSE.
 */
import { ArrowUpRight, Ban, Check, CircleAlert, Hourglass, Minus } from "lucide-react";
import { useState } from "react";
import { CircleIconButton, Elapsed, ErrorState, FactCell, FactStrip, Money, StatusDot, StatusPill, toneClasses } from "@/components/common";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, formatUsd } from "@/lib/format";
import { runStatusMeta, type Tone } from "@/lib/weft/labels";
import type { RunDetail } from "@/lib/weft/types";
import { cn } from "@/lib/utils";
import { currentPhase, DISCOVERY_PHASES, discoveryCounters, isTerminal, ledgerLines, pendingHumans, phaseItems, runInput, runOutput, type LedgerLine, type PhaseItem } from "./run-utils";

export interface RunProgressProps {
  runId: string;
  run: RunDetail | undefined;
  isPending?: boolean;
  error?: unknown;
  onRetry?: () => void;
  docLabel: "BRD" | "AAD";
  /** Hide counters and ledger (e.g. a one-line status above a draft). */
  compact?: boolean;
  /** Ledger length. */
  lines?: number;
  /** Only ledger lines from these phases (e.g. the discovery part of the run). */
  ledgerPhases?: RegExp;
  className?: string;
}

const DISCOVERY_ACTIVE = (run: RunDetail) => !isTerminal(run.status) && DISCOVERY_PHASES.test(currentPhase(run) ?? "");

/** A one-line summary of what the run is doing, for the card title. */
export function runHeadline(run: RunDetail, docLabel: string): string {
  const phase = currentPhase(run) ?? "";
  if (run.status === "failed") return "The run failed";
  if (run.status === "cancelled") return "The run was cancelled";
  if (run.status === "complete") {
    const out = runOutput(run);
    return out?.accepted ? `Finished: ${docLabel} accepted` : `Finished: ${docLabel} not accepted`;
  }
  if (run.status === "waiting_for_human") {
    const h = pendingHumans(run)[0];
    const key = h?.key ?? "";
    if (key.startsWith("deps:review")) return "Waiting on you: confirm the dependencies";
    if (key.startsWith("review:")) return `Waiting on you: review ${docLabel} round ${key.split(":")[1]}`;
    if (key.startsWith("memory:review")) return "Waiting on you: review the memory update";
    return "Waiting on you";
  }
  if (/^Discover/.test(phase)) return "Searching Jira and Confluence for dependencies";
  if (/^Draft (\d+)/.test(phase)) return `Writing ${docLabel} round ${phase.slice(6)}`;
  if (/^Update memory/.test(phase)) return "Proposing a shared-memory update";
  if (/^Memory/.test(phase)) return "Reading the shared memory";
  return "Preparing the run";
}

/** Each phase as a label over a striped segment (STYLE 5): full stripes when done, 60% while live. */
const PHASE_STYLE: Record<PhaseItem["state"], { tone: Tone; fill: "full" | "partial" | "none"; icon?: typeof Check; pulse?: boolean; label: string }> = {
  done: { tone: "success", fill: "full", icon: Check, label: "done" },
  current: { tone: "running", fill: "partial", pulse: true, label: "running" },
  waiting: { tone: "attention", fill: "partial", icon: Hourglass, label: "waiting on you" },
  failed: { tone: "danger", fill: "full", icon: CircleAlert, label: "failed" },
  future: { tone: "neutral", fill: "none", label: "not reached" },
  skipped: { tone: "neutral", fill: "none", icon: Minus, label: "skipped" },
};

export function PhaseStepper({ phases, className }: { phases: PhaseItem[]; className?: string }) {
  return (
    <ol aria-label="Workflow phases" className={cn("flex flex-wrap gap-x-2 gap-y-3", className)}>
      {phases.map((p) => {
        const st = PHASE_STYLE[p.state];
        const t = toneClasses(st.tone);
        const Icon = st.icon;
        const active = p.state === "current" || p.state === "waiting";
        return (
          <li key={p.name} className="flex min-w-[7rem] flex-1 flex-col gap-2" aria-current={active ? "step" : undefined}>
            <span className={cn("flex min-w-0 items-center gap-1.5 text-[13px] whitespace-nowrap", p.state === "future" || p.state === "skipped" ? "text-muted-foreground" : "font-medium text-heading", p.state === "skipped" && "line-through decoration-muted-foreground/60")}>
              {st.pulse ? <StatusDot tone="running" pulse size="sm" /> : Icon ? <Icon aria-hidden className={cn("size-3.5 shrink-0", t.text)} strokeWidth={2.5} /> : <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current opacity-40" />}
              <span className="truncate">{p.name}</span>
              <span className="sr-only">: {st.label}</span>
            </span>
            <span aria-hidden className="bar-track block h-2.5 overflow-hidden rounded-full">
              {st.fill !== "none" ? <span className={cn("block h-full rounded-full", t.stripe, st.fill === "partial" && "w-3/5 opacity-60")} /> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const LINE_TONE: Record<LedgerLine["status"], Tone> = { running: "running", ok: "success", failed: "danger", waiting: "attention", warn: "attention" };
const LINE_LABEL: Record<LedgerLine["status"], string> = { running: "running", ok: "done", failed: "failed", waiting: "waiting on you", warn: "command failed" };

export function RunLedger({ lines, className, label = "Latest steps" }: { lines: LedgerLine[]; className?: string; label?: string }) {
  if (lines.length === 0) return <p className={cn("text-[13px] text-muted-foreground", className)}>No steps yet.</p>;
  return (
    <ol aria-label={label} className={cn("divide-y divide-rule border-y border-rule", className)}>
      {lines.map((l) => (
        <li key={`${l.seq}-${l.status}`} className="flex min-h-11 min-w-0 items-center gap-3 px-1 py-2 text-sm">
          <StatusDot tone={LINE_TONE[l.status]} pulse={l.status === "running"} label={LINE_LABEL[l.status]} />
          <span className={cn("min-w-0 flex-1 truncate", l.status === "waiting" && "font-medium text-status-attention-fg", l.status === "warn" && "text-status-attention-fg")} title={l.text}>
            {l.text}
          </span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
            {l.status === "running" ? <Elapsed since={l.startedAt} /> : l.endedAt ? formatDuration(l.endedAt - l.startedAt, "human") : null}
            {l.usd ? <span className="ml-2">{formatUsd(l.usd)}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function RunProgress({ runId, run, isPending, error, onRetry, docLabel, compact, lines = 7, ledgerPhases, className }: RunProgressProps) {
  const [allSteps, setAllSteps] = useState(false);
  if (error && !run) {
    return (
      <div className={cn("card-surface rounded-2xl", className)}>
        <ErrorState title={`Could not load run ${runId}`} error={error} onRetry={onRetry} size="sm" />
      </div>
    );
  }
  if (isPending || !run) {
    return (
      <div className={cn("card-surface space-y-4 rounded-2xl p-5", className)} aria-busy="true" aria-label="Loading run progress">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-7 w-full" />
        {!compact ? <Skeleton className="h-14 w-full" /> : null}
      </div>
    );
  }
  const meta = runStatusMeta(run.status);
  const counters = discoveryCounters(run);
  const input = runInput(run);
  const terminal = isTerminal(run.status);
  const limit = run.limits?.usd;
  const ledger = compact ? [] : ledgerLines(run, docLabel, ledgerPhases);
  const hidden = allSteps ? 0 : Math.max(0, ledger.length - lines);
  const shown = hidden ? ledger.slice(-lines) : ledger;
  const waiting = run.status === "waiting_for_human";

  return (
    <section aria-label="Run progress" className={cn("@container card-surface space-y-5 rounded-2xl p-5", className)}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted-foreground">
            <span>{run.workflow}</span>
            <span aria-hidden>·</span>
            <span>{run.runId}</span>
            {currentPhase(run) && !terminal ? (
              <>
                <span aria-hidden>·</span>
                <span>{currentPhase(run)}</span>
              </>
            ) : null}
          </div>
          <h3 className="text-[18px] leading-7 font-medium tracking-[-0.015em] text-heading @xl:text-[20px]">{runHeadline(run, docLabel)}</h3>
        </div>
        {/* The headline already says "Waiting on you: …"; a "Needs your input" pill would repeat it. */}
        {!waiting ? <StatusPill {...meta} variant="chip" className="mt-1 hidden @md:inline-flex" /> : null}
        <CircleIconButton href={`/runs/${run.runId}`} icon={ArrowUpRight} label="Open run inspector" title="Open run inspector" />
      </div>
      {!waiting ? <StatusPill {...meta} variant="chip" className="-mt-2 @md:hidden" /> : null}

      <PhaseStepper phases={phaseItems(run)} />

      {run.status === "failed" && run.error ? (
        <p role="alert" className="flex items-start gap-2.5 rounded-[16px] bg-status-danger-bg px-4 py-3 text-[13px] text-status-danger-fg">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 break-words">{run.error.message}</span>
        </p>
      ) : null}
      {run.status === "cancelled" ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Ban aria-hidden className="size-4" />
          Cancelled; open requests were superseded.
        </p>
      ) : null}

      {!compact ? (
        <>
          <FactStrip>
            <FactCell label="Sources fetched" value={<span className="tabular-nums">{counters.fetched}</span>} hint={input.discover === false ? "discovery off" : undefined} />
            <FactCell label="Searches run" value={<span className="tabular-nums">{counters.searches}</span>} hint={counters.planner ? `${counters.planner} search ${counters.planner === 1 ? "round" : "rounds"}` : undefined} />
            <FactCell label="Rejected commands" value={<span className={cn("tabular-nums", counters.rejected > 0 && "text-status-attention-fg")}>{counters.rejected}</span>} hint="outside the atl allowlist" />
            <FactCell
              label="Spend"
              value={
                <span>
                  <Money usd={run.budget.usd} />
                  {limit ? <span className="text-muted-foreground"> of {formatUsd(limit)}</span> : null}
                </span>
              }
              hint={`${run.budget.tokens.toLocaleString()} tok`}
            />
            <FactCell label="Elapsed" numeric value={<Elapsed since={run.createdAt} until={terminal ? run.updatedAt : undefined} />} />
          </FactStrip>
          {ledger.length > lines ? (
            <div className="-mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
              <span>
                {hidden ? `Latest ${shown.length} of ${ledger.length} ${ledgerPhases ? "discovery " : ""}steps` : `All ${ledger.length} ${ledgerPhases ? "discovery " : ""}steps`}
                {ledgerPhases && DISCOVERY_ACTIVE(run) && !waiting ? "; more appear as discovery runs" : ""}
              </span>
              <button
                type="button"
                onClick={() => setAllSteps((a) => !a)}
                aria-expanded={allSteps}
                className="rounded font-medium text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {allSteps ? "Show the latest only" : `See all ${ledger.length} steps`}
              </button>
            </div>
          ) : null}
          <RunLedger lines={shown} label={hidden ? "Latest steps" : "Steps"} />
        </>
      ) : null}
    </section>
  );
}
