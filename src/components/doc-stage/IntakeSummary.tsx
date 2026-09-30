"use client";

/**
 * Read-only view of what a po-brd / architect-aad run started from: the request (input.request),
 * the requirement channels marked as "seed" (Jira, Confluence) or "note" (files, pasted text),
 * the run options, the output path, and the stage's run history.
 */
import type { ReactNode } from "react";
import { FactCell, FactStrip, RelativeTime } from "@/components/common";
import { SOURCE_ICONS } from "@/components/projects";
import { RunChip } from "@/components/stage";
import type { RequirementSource, RunOptions, StageView } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";

export function SourceChips({ sources, className }: { sources: RequirementSource[]; className?: string }) {
  if (sources.length === 0) return <p className={cn("text-sm text-muted-foreground", className)}>No extra sources.</p>;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Requirement channels">
      {sources.map((s) => {
        const Icon = SOURCE_ICONS[s.kind];
        const text = s.kind === "note-text" ? s.label : s.value;
        return (
          <li
            key={s.id}
            title={s.kind === "note-text" ? s.value : s.label}
            className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-well pr-1 pl-3 text-[13px] text-heading"
          >
            <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className={cn("min-w-0 truncate", s.kind !== "note-text" && "font-mono")}>{text}</span>
            <span
              className={cn(
                "inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[11px] font-medium",
                s.mapsTo === "seeds" ? "bg-status-running-bg text-status-running-fg" : "bg-raised text-muted-foreground shadow-(--raised-shadow)",
              )}
            >
              {s.mapsTo === "seeds" ? "seed" : "note"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function OptionsStrip({ options, out, extra }: { options: RunOptions; out: string; extra?: ReactNode }) {
  return (
    <FactStrip>
      <FactCell label="Review rounds" value={<span className="tabular-nums">up to {options.maxRounds}</span>} />
      <FactCell
        label="Discovery"
        value={options.discover ? <span className="tabular-nums">{options.discoveryRounds} × {options.maxQueries} searches</span> : "Off"}
        hint={options.discover ? "rounds × searches per round" : "seeds and notes only"}
      />
      <FactCell label="Budget" mono value={options.budget || "default"} />
      <FactCell label="Writes" mono value={<span className="break-all">{out}</span>} />
      {extra}
    </FactStrip>
  );
}

export function RequestText({ text, empty = "No request text; the notes carry the ask." }: { text: string; empty?: string }) {
  if (!text.trim()) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return <p className="rounded-[20px] bg-well/60 px-4 py-3.5 text-[15px] leading-6 break-words whitespace-pre-wrap text-heading">{text}</p>;
}

export function RunHistory({ runs, workflowLabel }: { runs: StageView["runs"]; workflowLabel: string }) {
  if (runs.length === 0) return null;
  const sorted = [...runs].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="space-y-1.5">
      <h4 className="text-sm font-medium text-heading">
        {workflowLabel} {sorted.length === 1 ? "run" : "runs"} {sorted.length > 1 ? <span className="font-normal text-muted-foreground tabular-nums">{sorted.length}</span> : null}
      </h4>
      <ul className="flex flex-col gap-1.5">
        {sorted.map((r, i) => (
          <li key={r.runId} className="flex flex-wrap items-center gap-2">
            <RunChip runId={r.runId} workflow={r.workflow} status={r.status} />
            <RelativeTime at={r.createdAt} prefix="started " className="text-[13px] text-muted-foreground" />
            {i === 0 && sorted.length > 1 ? <span className="text-xs text-muted-foreground">latest</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
