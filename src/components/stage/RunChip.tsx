"use client";

/**
 * `po-brd · a3f09b1c · Running` as a mono chip linking to the run inspector. With `quiet` the
 * status shows as a dot only (its label stays in the tooltip and for screen readers), for places
 * where a pill beside it already says the same, like the stage header's "Needs input".
 */
import Link from "next/link";
import { StatusDot } from "@/components/common";
import { runStatusMeta } from "@/lib/weft/labels";
import type { RunStatus } from "@/lib/weft/types";
import { cn } from "@/lib/utils";
import { TONE_CLASS } from "../hitl/bits";

export function RunChip({ runId, workflow, status, quiet, className }: { runId: string; workflow: string; status?: RunStatus; quiet?: boolean; className?: string }) {
  const meta = status ? runStatusMeta(status) : undefined;
  return (
    <Link
      href={`/runs/${runId}`}
      className={cn(
        "relative inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-2.5 font-mono text-[11px] whitespace-nowrap text-foreground transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
      title={`Open run ${runId}${meta ? ` (${meta.label})` : ""}`}
    >
      {meta && quiet ? (
        <>
          <StatusDot tone={meta.tone} pulse={meta.pulse} size="sm" />
          <span className="sr-only">{meta.label}:</span>
        </>
      ) : null}
      <span className="truncate">{workflow}</span>
      <span className="text-muted-foreground">·</span>
      <span>{runId}</span>
      {meta && !quiet ? (
        <>
          <span className="text-muted-foreground">·</span>
          <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 font-sans text-[10.5px] font-medium", TONE_CLASS[meta.tone])}>
            <StatusDot tone={meta.tone} pulse={meta.pulse} size="sm" />
            {meta.label}
          </span>
        </>
      ) : null}
    </Link>
  );
}
