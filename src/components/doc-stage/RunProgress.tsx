"use client";

/**
 * Live progress of a po-brd / architect-aad run: a mini stepper of the weft phases (Preflight →
 * Memory → Discover → Draft N → Update memory), discovery counters (sources fetched, searches
 * run, rejected commands), a spend ticker against the budget, elapsed time, and a compact ledger
 * of the latest steps. Everything re-renders from useRun, which live.ts invalidates over SSE.
 */
import { ArrowUpRight, Ban, Check, CircleAlert, Hourglass, Minus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Elapsed, ErrorState, FactCell, FactStrip, Money, StatusDot, StatusPill } from "@/components/common";
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

const PHASE_STYLE: Record<PhaseItem["state"], { cls: string; icon?: typeof Check; tone?: Tone; pulse?: boolean; label: string }> = {
  done: { cls: "bg-status-success-bg text-status-success-fg", icon: Check, label: "done" },
  current: { cls: "bg-status-running-bg text-status-running-fg", tone: "running", pulse: true, label: "running" },
  waiting: { cls: "bg-status-attention-bg text-status-attention-fg", icon: Hourglass, label: "waiting on you" },
  failed: { cls: "bg-status-danger-bg text-status-danger-fg", icon: CircleAlert, label: "failed" },
  future: { cls: "border border-dashed border-border text-muted-foreground", label: "not reached" },
  skipped: { cls: "bg-muted text-muted-foreground line-through decoration-muted-foreground/60", icon: Minus, label: "skipped" },
};

export function PhaseStepper({ phases, className }: { phases: PhaseItem[]; className?: string }) {
  return (
    <ol aria-label="Workflow phases" className={cn("flex flex-wrap items-center gap-x-1 gap-y-1.5", className)}>
      {phases.map((p, i) => {
        const st = PHASE_STYLE[p.state];
        const Icon = st.icon;
        return (
          <li key={p.name} className="flex items-center gap-1">
            {i > 0 ? <span aria-hidden className={cn("h-px w-3 @md:w-5", p.state === "future" ? "bg-border" : "bg-foreground/25")} /> : null}
            <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap", st.cls)} aria-current={p.state === "current" || p.state === "waiting" ? "step" : undefined}>
              {st.pulse ? <StatusDot tone="running" pulse size="sm" /> : Icon ? <Icon aria-hidden className="size-3.5" strokeWidth={2.25} /> : <span aria-hidden className="size-1.5 rounded-full bg-current opacity-50" />}
              {p.name}
              <span className="sr-only">: {st.label}</span>
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
    <ol aria-label={label} className={cn("divide-y divide-border rounded-xl border border-border", className)}>
      {lines.map((l) => (
        <li key={`${l.seq}-${l.status}`} className="flex min-w-0 items-center gap-2.5 px-3 py-1.5 text-[13px]">
          <StatusDot tone={LINE_TONE[l.status]} pulse={l.status === "running"} label={LINE_LABEL[l.status]} />
          <span className={cn("min-w-0 flex-1 truncate", l.status === "waiting" && "font-medium text-status-attention-fg", l.status === "warn" && "text-status-attention-fg")} title={l.text}>
            {l.text}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
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
      <div className={cn("card-surface space-y-3 rounded-2xl p-4", className)} aria-busy="true" aria-label="Loading run progress">
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
    <section aria-label="Run progress" className={cn("@container card-surface space-y-3 rounded-2xl p-4", className)}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-64 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted-foreground">
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
          <h3 className="text-[15px] leading-snug font-medium">{runHeadline(run, docLabel)}</h3>
        </div>
        {/* The headline already says "Waiting on you: …"; a "Needs your input" pill would repeat it. */}
        {!waiting ? <StatusPill {...meta} /> : null}
        <Link
          href={`/runs/${run.runId}`}
          className="inline-flex h-6 items-center gap-1 rounded-full px-1 text-xs font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Open run inspector
          <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      </div>

      <PhaseStepper phases={phaseItems(run)} />

      {run.status === "failed" && run.error ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-status-danger-bg px-3 py-2 text-[13px] text-status-danger-fg">
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
            <FactCell label="Elapsed" mono value={<Elapsed since={run.createdAt} until={terminal ? run.updatedAt : undefined} />} />
          </FactStrip>
          {ledger.length > lines ? (
            <div className="-mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>
                {hidden ? `Latest ${shown.length} of ${ledger.length} ${ledgerPhases ? "discovery " : ""}steps` : `All ${ledger.length} ${ledgerPhases ? "discovery " : ""}steps`}
                {ledgerPhases && DISCOVERY_ACTIVE(run) && !waiting ? "; more appear as discovery runs" : ""}
              </span>
              <button
                type="button"
                onClick={() => setAllSteps((a) => !a)}
                aria-expanded={allSteps}
                className="rounded font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
