"use client";

/**
 * Every pending non-gate human request of a set of runs, oldest first, as HumanRequestCards.
 * Pass runIds (fetched per run from GET /api/weft/runs/:id/pending, refreshed by live.ts), or
 * requests you already have (e.g. the bundle's inbox items), or both.
 */
import { useQueries } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { weft } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import type { HumanState, PendingRequest } from "@/lib/weft/types";
import type { PlannedTask } from "@/lib/weft/workflows";
import { cn } from "@/lib/utils";
import { HumanRequestCard } from "./HumanRequestCard";

export interface RequestListItem {
  runId: string;
  request: PendingRequest | HumanState;
  workflow?: string;
}

export interface RequestListProps {
  runIds?: string[];
  requests?: RequestListItem[];
  projectId: string;
  emptyText?: string;
  compact?: boolean;
  /** "<runId>:<hId>" to scroll to and highlight. */
  focus?: string;
  /** Hide requests of these runs (rendered inline elsewhere on the page). */
  hideRunIds?: string[];
  editedTasks?: PlannedTask[];
  className?: string;
}

function createdAt(r: PendingRequest | HumanState): number {
  return "requestedAt" in r ? r.requestedAt : r.createdAt;
}

export function RequestList({ runIds = [], requests = [], projectId, emptyText = "Nothing is waiting on a person.", compact, focus, hideRunIds, editedTasks, className }: RequestListProps) {
  const hidden = new Set(hideRunIds ?? []);
  const ids = [...new Set(runIds)].filter((id) => !hidden.has(id));
  const results = useQueries({
    queries: ids.map((runId) => ({ queryKey: qk.runPending(runId), queryFn: () => weft.runPending(runId) })),
  });

  const seen = new Set<string>();
  const items: RequestListItem[] = [];
  const push = (item: RequestListItem) => {
    const k = `${item.runId}:${item.request.id}`;
    if (seen.has(k) || hidden.has(item.runId) || item.request.kind === "gate") return;
    if ("status" in item.request && item.request.status !== "pending") return;
    seen.add(k);
    items.push(item);
  };
  requests.forEach(push);
  results.forEach((q) => {
    // /pending includes live descendants, so post to each entry's own runId.
    for (const r of q.data ?? []) push({ runId: r.runId, request: r });
  });
  items.sort((a, b) => createdAt(a.request) - createdAt(b.request));

  const loading = results.some((q) => q.isPending) && items.length === 0;
  const failed = results.filter((q) => q.isError);

  if (loading) {
    return (
      <div className={cn("space-y-3", className)} aria-busy="true">
        <Skeleton className="h-28 w-full rounded-2xl" />
      </div>
    );
  }
  return (
    <div className={cn("space-y-3", className)}>
      {failed.length > 0 ? (
        <p role="alert" className="text-[13px] text-destructive">
          Could not load requests for {failed.length} run{failed.length === 1 ? "" : "s"}: {failed[0]?.error?.message}
        </p>
      ) : null}
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
          <Inbox aria-hidden className="size-5" />
          {emptyText}
        </div>
      ) : (
        items.map((item) => (
          <HumanRequestCard
            key={`${item.runId}:${item.request.id}`}
            runId={item.runId}
            request={item.request}
            workflow={item.workflow}
            projectId={projectId}
            compact={compact}
            focused={focus === `${item.runId}:${item.request.id}`}
            editedTasks={editedTasks}
          />
        ))
      )}
    </div>
  );
}
