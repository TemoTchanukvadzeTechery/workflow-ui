"use client";

/**
 * The open human requests of one run whose key starts with a prefix ("deps:review:", "review:",
 * "memory:review"), rendered inline in the stage page with the bespoke HITL forms. The stage
 * layout's rail hides this run's requests, so each one appears exactly once on the page.
 */
import { HumanRequestCard } from "@/components/hitl";
import type { RunDetail } from "@/lib/weft/types";
import { cn } from "@/lib/utils";
import { pendingHumans } from "./run-utils";

export interface InlineRequestsProps {
  projectId: string;
  runId: string;
  run: RunDetail | undefined;
  prefix: string;
  /** "<runId>:<hId>" to scroll to and highlight. */
  focus?: string;
  onAnswered?: () => void;
  memoryStale?: string[];
  className?: string;
}

export function InlineRequests({ projectId, runId, run, prefix, focus, onAnswered, memoryStale, className }: InlineRequestsProps) {
  const open = pendingHumans(run).filter((h) => (h.key ?? "").startsWith(prefix));
  if (open.length === 0) return null;
  return (
    <div className={cn("space-y-3", className)}>
      {open.map((h) => (
        <HumanRequestCard
          key={`${runId}:${h.id}`}
          runId={runId}
          request={h}
          workflow={run?.workflow}
          projectId={projectId}
          focused={focus === `${runId}:${h.id}`}
          onAnswered={onAnswered}
          memoryStale={memoryStale}
        />
      ))}
    </div>
  );
}

/** Whether a run has an open request with this prefix. */
export function hasOpenRequest(run: RunDetail | undefined, prefix: string): boolean {
  return pendingHumans(run).some((h) => (h.key ?? "").startsWith(prefix));
}
