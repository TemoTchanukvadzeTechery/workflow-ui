"use client";

/**
 * `po-brd · a3f09b1c · Running` as a mono chip linking to the run inspector. With `quiet` the
 * status shows as a dot only (its label stays in the tooltip and for screen readers), for places
 * where a pill beside it already says the same, like the stage header's "Needs input".
 * `variant="segment"` is the raised segment of a ToolbarGroup (the stage header's run group).
 */
import Link from "next/link";
import { StatusDot, toneClasses } from "@/components/common";
import { runStatusMeta } from "@/lib/weft/labels";
import type { RunStatus } from "@/lib/weft/types";
import { cn } from "@/lib/utils";

export interface RunChipProps {
  runId: string;
  workflow: string;
  status?: RunStatus;
  quiet?: boolean;
  /** chip (default): an inline well pill; segment: a raised segment inside a ToolbarGroup. */
  variant?: "chip" | "segment";
  className?: string;
}

export function RunChip({ runId, workflow, status, quiet, variant = "chip", className }: RunChipProps) {
  const meta = status ? runStatusMeta(status) : undefined;
  const segment = variant === "segment";
  return (
    <Link
      href={`/runs/${runId}`}
      className={cn(
        "relative inline-flex max-w-full shrink-0 items-center font-mono whitespace-nowrap text-heading outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        segment
          ? "h-9 gap-2 rounded-[12px] bg-raised px-3 text-xs shadow-(--raised-shadow) transition-[background-color] hover:bg-(--chip-bg)"
          : "h-7 gap-1.5 rounded-full bg-well px-2.5 text-[11.5px] transition-colors hover:bg-well-hover",
        className,
      )}
      title={`Open run ${runId}${meta ? ` (${meta.label})` : ""}`}
    >
      {meta && (quiet || segment) ? (
        <>
          <StatusDot tone={meta.tone} pulse={meta.pulse} size={segment ? "md" : "sm"} />
          <span className="sr-only">{meta.label}:</span>
        </>
      ) : null}
      <span className="truncate">{workflow}</span>
      <span aria-hidden className="text-muted-foreground">
        ·
      </span>
      <span className={segment ? "text-muted-foreground" : undefined}>{runId}</span>
      {meta && !quiet ? (
        segment ? (
          <span aria-hidden className={cn("font-sans text-xs font-medium", toneClasses(meta.tone).text)}>
            {meta.label}
          </span>
        ) : (
          <>
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            <span className={cn("inline-flex h-5 items-center gap-1 rounded-full px-1.5 font-sans text-[11px] font-medium", toneClasses(meta.tone).bg, toneClasses(meta.tone).text)}>
              <StatusDot tone={meta.tone} pulse={meta.pulse} size="sm" />
              {meta.label}
            </span>
          </>
        )
      ) : null}
    </Link>
  );
}
