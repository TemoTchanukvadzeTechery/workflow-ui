"use client";

/**
 * Weft's RunRail restyled: one linear list of steps grouped by phase, human requests at their
 * position, policy gates behind a toggle. Rows show a status dot, the kind in uppercase mono,
 * the step key, a patch badge, and duration (live for running steps) or tokens and cost.
 */
import { ChevronDown, GitCommitHorizontal, ShieldCheck } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Elapsed, StatusDot } from "@/components/common";
import { formatTokens, formatUsd, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RunDetail } from "@/lib/weft/types";
import { buildLedger, entryKind, entryState, entryTitle, isPolicyGate, policyGates, staticMeta, type LedgerEntry, type LedgerGroup } from "./ledger-model";

export interface RunLedgerProps {
  run: RunDetail;
  selectedSeq?: number;
  onSelect?: (seq: number) => void;
  /** Show policy-approved tool gates. Uncontrolled default when `onShowGatesChange` is absent. */
  showGates?: boolean;
  onShowGatesChange?: (show: boolean) => void;
  /** Tighter rows and no sticky header, for embedding (task page). */
  compact?: boolean;
  /** Title above the list; default "Run tree · N steps recorded". */
  title?: string;
  className?: string;
}

export function RunLedger({ run, selectedSeq, onSelect, showGates, onShowGatesChange, compact, title, className }: RunLedgerProps) {
  const [localGates, setLocalGates] = useState(showGates ?? false);
  const gatesOn = onShowGatesChange ? (showGates ?? false) : localGates;
  const setGates = (v: boolean) => (onShowGatesChange ? onShowGatesChange(v) : setLocalGates(v));
  const groups = useMemo(() => buildLedger(run, { showGates: gatesOn }), [run, gatesOn]);
  const gateCount = useMemo(() => policyGates(run).length, [run]);

  return (
    <nav aria-label="Run steps" className={cn("flex min-w-0 flex-col", className)}>
      <div className={cn("flex items-center justify-between gap-2 px-4", compact ? "pt-3.5 pb-2" : "pt-4 pb-2.5")}>
        <span className="truncate text-[15px] font-medium text-heading">{title ?? `Run tree · ${plural(run.steps.length, "step")} recorded`}</span>
      </div>
      {groups.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">This run has not opened a step yet.</p>
      ) : (
        <div className="flex flex-col gap-1 pb-2">
          {groups.map((g) => (
            <LedgerGroupBlock key={g.key} group={g} selectedSeq={selectedSeq} onSelect={onSelect} compact={compact} />
          ))}
        </div>
      )}
      {gateCount > 0 && (
        <div className="border-t border-rule px-2 py-2">
          <button
            type="button"
            onClick={() => setGates(!gatesOn)}
            aria-pressed={gatesOn}
            className="flex min-h-9 w-full items-center gap-2 rounded-[12px] px-2.5 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-heading focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <ShieldCheck aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {gateCount} tool {gateCount === 1 ? "gate" : "gates"} auto-approved by policy
            </span>
            <span className="shrink-0 font-medium text-foreground/80">{gatesOn ? "Hide" : "Show"}</span>
          </button>
        </div>
      )}
    </nav>
  );
}

/** "3 steps · 1 request · 4.4k tok · $0.86"; a phase with only a review says "1 request", not "0 steps". */
function groupMeta(g: LedgerGroup): string {
  const requests = g.entries.filter((e) => e.type === "human" && !isPolicyGate(e.human)).length;
  const parts: string[] = [];
  if (g.steps > 0 || requests === 0) parts.push(plural(g.steps, "step"));
  if (requests > 0) parts.push(plural(requests, "request"));
  if (g.tokens > 0) parts.push(formatTokens(g.tokens, { compact: true }));
  if (g.usd > 0) parts.push(formatUsd(g.usd));
  return parts.join(" · ");
}

function LedgerGroupBlock({ group, selectedSeq, onSelect, compact }: { group: LedgerGroup; selectedSeq?: number; onSelect?: (seq: number) => void; compact?: boolean }) {
  const id = useId();
  const hasSelected = selectedSeq !== undefined && group.entries.some((e) => e.seq === selectedSeq);
  // Long, finished phases start folded in compact mode so the list stays short.
  const foldable = group.entries.length > 8;
  const [open, setOpen] = useState(!compact || !foldable || group.running > 0 || group.waiting > 0 || group.failed > 0);
  const expanded = open || hasSelected;

  return (
    <div role="group" aria-labelledby={id} className="flex flex-col">
      <button
        type="button"
        id={id}
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        className="group/phase mx-1 flex items-center gap-2 rounded-[10px] px-3 pt-3 pb-1.5 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="truncate text-[13px] font-medium text-heading first-letter:uppercase">{group.name}</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{groupMeta(group)}</span>
        {group.waiting > 0 && <StatusDot tone="attention" size="sm" label={`${group.waiting} waiting`} />}
        {group.running > 0 && <StatusDot tone="running" pulse size="sm" label={`${group.running} running`} />}
        {group.failed - group.recovered > 0 && <StatusDot tone="danger" size="sm" label={`${group.failed - group.recovered} failed`} />}
        {group.recovered > 0 && <StatusDot tone="attention" size="sm" label={`${group.recovered} failed, then passed on retry`} />}
        <span className="flex-1" />
        <ChevronDown aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground opacity-0 transition-transform group-hover/phase:opacity-100 group-focus-visible/phase:opacity-100", !expanded && "-rotate-90 opacity-100")} />
      </button>
      {expanded && (
        <ul className="flex flex-col gap-0.5 px-1.5">
          {group.entries.map((e) => (
            <li key={`${e.type}:${e.seq}`}>
              <LedgerRow entry={e} selected={e.seq === selectedSeq} onSelect={onSelect} compact={compact} />
            </li>
          ))}
          {group.hiddenGates > 0 && (
            <li className="px-2 py-1 pl-[32px] text-xs text-muted-foreground">+ {plural(group.hiddenGates, "policy gate")}</li>
          )}
        </ul>
      )}
    </div>
  );
}

function LedgerRow({ entry, selected, onSelect, compact }: { entry: LedgerEntry; selected: boolean; onSelect?: (seq: number) => void; compact?: boolean }) {
  const st = entryState(entry);
  const running = entry.type === "step" && entry.step.status === "running";
  const failed = st.tone === "danger";
  const waiting = entry.type === "human" && entry.human.status === "pending";
  const title = entryTitle(entry);
  const label = entry.type === "step" ? entry.step.label : entry.human.question;

  return (
    <button
      type="button"
      onClick={() => onSelect?.(entry.seq)}
      aria-current={selected ? "step" : undefined}
      aria-label={`${entryKind(entry)} ${title}, ${st.label}${waiting ? ", open the request" : ""}`}
      title={label && label !== title ? label : undefined}
      data-seq={entry.seq}
      className={cn(
        "relative flex w-full min-w-0 items-center gap-2.5 rounded-[12px] px-2.5 text-left transition-[background-color,box-shadow] duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        compact ? "h-9" : "h-10",
        "hover:bg-foreground/[0.04]",
        running && "bg-status-running-bg text-status-running-fg",
        failed && "bg-status-danger-bg/60",
        waiting && "bg-status-attention-bg",
        selected && "bg-raised shadow-[var(--raised-shadow),0_0_0_1px_var(--circle-border)] hover:bg-raised",
      )}
      style={entry.depth ? { paddingLeft: 8 + entry.depth * 14 } : undefined}
    >
      {running && <span aria-hidden className="hatch pointer-events-none absolute inset-y-1 left-0 w-[3px] rounded-full text-status-running-fg" />}
      <StatusDot tone={st.tone} pulse={st.pulse} size="md" />
      <span className="w-[44px] shrink-0 truncate font-mono text-[11px] text-muted-foreground lowercase">{entryKind(entry)}</span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-mono text-[13px] text-heading",
          (running || waiting || failed) && "font-semibold",
          running && "text-status-running-fg",
          entry.type === "human" && entry.human.answeredBy === "policy" && "text-muted-foreground",
        )}
      >
        {title}
      </span>
      {entry.type === "step" && entry.step.patchRef && (
        <span className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full bg-status-success-bg px-1.5 font-mono text-[11px] text-status-success-fg">
          <GitCommitHorizontal aria-hidden className="size-3" />
          patch
        </span>
      )}
      <RowMeta entry={entry} />
    </button>
  );
}

function RowMeta({ entry }: { entry: LedgerEntry }) {
  const cls = "shrink-0 text-xs tabular-nums text-muted-foreground";
  if (entry.type === "human") {
    const h = entry.human;
    if (h.status === "pending") return <Elapsed since={h.requestedAt} className={cn(cls, "text-status-attention-fg")} />;
    if (h.answeredBy === "policy") return <span className={cls}>policy</span>;
    if (h.status === "superseded") return <span className={cls}>superseded</span>;
    return <span className={cls}>answered</span>;
  }
  const s = entry.step;
  if (s.status === "running") return <Elapsed since={s.startedAt} className={cn(cls, "text-status-running-fg")} />;
  return <span className={cn(cls, s.status === "failed" && "text-status-danger-fg")}>{staticMeta(s)}</span>;
}
