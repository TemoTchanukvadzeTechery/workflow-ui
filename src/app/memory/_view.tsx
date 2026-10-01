"use client";

/**
 * /memory: the read-only overview of the po-workspace memory vault (plan A2/A3). Four tabs, kept
 * in `?view=` (use-memory-view.ts): Table, Graph (plan A5; shares the table's type-group filter
 * and can hide notes without connections, on by default), Health (plan §3) and Timeline (plan
 * §4). The header is MemoryHero: the title, the tabs and refresh under the description, and the
 * data brain drawn from the same graph cache as the Graph tab.
 * Error/empty states per plan A7: vault missing → full ErrorState with the resolved paths and the
 * env hint (from /api/memory/status); index building → skeleton with a caption about the first
 * build; a claim-less vault reads as quiet, not broken.
 */
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Check, HeartPulse, History, Loader2, RefreshCw, Rows3, Waypoints, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { CardSkeleton, CircleIconButton, EmptyState, ErrorState, SectionCard, SegmentedControl, type SegmentedItem } from "@/components/common";
import { MemoryHero } from "@/components/memory/brain/memory-hero";
import { filterGraph } from "@/components/memory/graph-layout";
import { MemoryHealthPanel } from "@/components/memory/health/health-panel";
import { MemoryGraph } from "@/components/memory/memory-graph";
import { MemoryNoteTable } from "@/components/memory/note-table";
import { MemoryStaleBand } from "@/components/memory/stale-band";
import { MemoryStatsHeader } from "@/components/memory/stats-header";
import { TYPES_BY_GROUP, typeGroupItems } from "@/components/memory/status-meta";
import { MemoryTimelinePanel } from "@/components/memory/timeline/timeline-panel";
import { useMemoryView, type MemoryViewMode } from "@/components/memory/use-memory-view";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useMemoryGraph, useMemoryOverview, useMemoryStatus } from "@/lib/api/queries";
import { plural } from "@/lib/format";
import type { MemoryNoteListItem, MemoryNoteType, MemoryTypeGroup, MemoryWorkspaceCheck } from "@/lib/memory/types";
import { cn } from "@/lib/utils";

const VIEW_ITEMS: ReadonlyArray<SegmentedItem<MemoryViewMode>> = [
  { value: "table", label: "Table", icon: Rows3, id: "memory-tab-table", controls: "memory-panel-table" },
  { value: "graph", label: "Graph", icon: Waypoints, id: "memory-tab-graph", controls: "memory-panel-graph" },
  { value: "health", label: "Health", icon: HeartPulse, id: "memory-tab-health", controls: "memory-panel-health" },
  { value: "timeline", label: "Timeline", icon: History, id: "memory-tab-timeline", controls: "memory-panel-timeline" },
];

/** Every memory query: refresh invalidates them all, and the spinner turns while any refetches. */
const MEMORY_PREFIX = ["memory"] as const;

export function MemoryView() {
  // Poll while the index builds so the skeleton flips to content the moment the build lands.
  const status = useMemoryStatus({
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && d.check.ok && d.indexState !== "ready" ? 2_500 : false;
    },
  });
  const overview = useMemoryOverview();
  const { view, setView } = useMemoryView();
  const qc = useQueryClient();
  const refreshing = useIsFetching({ queryKey: MEMORY_PREFIX }) > 0;

  const check = status.data?.check;
  const vaultMissing = !!check && !check.ok;
  const building = !!status.data && status.data.check.ok && status.data.indexState !== "ready";
  // The header's brain and the Graph tab share this cache.
  const graph = useMemoryGraph({ enabled: !vaultMissing });
  // Refetches what is mounted (status, overview, graph, the open tab) and marks the rest stale.
  const refresh = () => void qc.invalidateQueries({ queryKey: MEMORY_PREFIX });

  return (
    <div className="flex flex-col gap-6 lg:gap-7">
      <MemoryHero
        description={
          <>
            The organizational memory the pipeline reads and cites: typed notes, claims and their connections from the po-workspace vault. Documents reference it as{" "}
            <span className="font-mono whitespace-nowrap text-foreground">[M note-id]</span>. Read-only here; the vault is edited in Obsidian or by memory updates.
          </>
        }
        toolbar={
          vaultMissing ? undefined : (
            <div className="flex min-w-0 items-center gap-2">
              <SegmentedControl<MemoryViewMode> role="tablist" aria-label="Memory view" value={view} onValueChange={setView} items={VIEW_ITEMS} />
              <CircleIconButton
                icon={<RefreshCw aria-hidden className={cn("size-[18px]", refreshing && "animate-spin")} strokeWidth={1.75} />}
                label="Refresh from the vault"
                size="md"
                className="shrink-0"
                onClick={refresh}
                disabled={refreshing}
              />
            </div>
          )
        }
        graph={vaultMissing ? undefined : graph.data}
      />

      {vaultMissing ? (
        <VaultMissing check={check} onRetry={refresh} />
      ) : view === "graph" ? (
        <div role="tabpanel" id="memory-panel-graph" aria-labelledby="memory-tab-graph">
          <GraphPanel building={building} notes={overview.data?.notes} />
        </div>
      ) : view === "health" ? (
        <div role="tabpanel" id="memory-panel-health" aria-labelledby="memory-tab-health">
          <MemoryHealthPanel building={building} />
        </div>
      ) : view === "timeline" ? (
        <div role="tabpanel" id="memory-panel-timeline" aria-labelledby="memory-tab-timeline">
          <MemoryTimelinePanel />
        </div>
      ) : (
        <div role="tabpanel" id="memory-panel-table" aria-labelledby="memory-tab-table" className="flex flex-col gap-6 lg:gap-7">
          {overview.isPending ? (
            <OverviewSkeleton building={building} />
          ) : overview.error || !overview.data ? (
            <SectionCard>
              <ErrorState title="Could not load the memory vault" error={overview.error ?? undefined} onRetry={() => void overview.refetch()} />
            </SectionCard>
          ) : (
            <>
              <MemoryStatsHeader stats={overview.data.stats} />
              <MemoryStaleBand stale={overview.data.stale} />
              <MemoryNoteTable notes={overview.data.notes} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Hide unconnected notes by default: they float around the edge and carry no structure. */
function GraphPanel({ building, notes }: { building: boolean; notes?: MemoryNoteListItem[] }) {
  const graph = useMemoryGraph();
  const switchId = useId();
  const [group, setGroup] = useState<MemoryTypeGroup>("all");
  const [hideUnconnected, setHideUnconnected] = useState(true);
  const data = graph.data;

  const byType = useMemo(() => {
    const m: Partial<Record<MemoryNoteType, number>> = {};
    for (const n of data?.nodes ?? []) m[n.type] = (m[n.type] ?? 0) + 1;
    return m;
  }, [data]);
  const types = useMemo(() => (group === "all" ? undefined : new Set(TYPES_BY_GROUP[group])), [group]);
  // One pass with hiding on gives both counts: what shows and how many the toggle removes.
  const counts = useMemo(() => (data ? filterGraph(data, { types, hideUnconnected: true }) : null), [data, types]);
  // The graph payload has no summaries; the overview (already loaded for the table) does.
  const summaries = useMemo(() => (notes ? Object.fromEntries(notes.map((n) => [n.card.id, n.card.summary])) : undefined), [notes]);

  if (graph.isPending) return <GraphSkeleton building={building} />;
  if (graph.error || !data || !counts) {
    return (
      <SectionCard>
        <ErrorState title="Could not load the memory graph" error={graph.error ?? undefined} onRetry={() => void graph.refetch()} />
      </SectionCard>
    );
  }
  if (data.nodes.length === 0) {
    return (
      <SectionCard>
        <EmptyState
          icon={Waypoints}
          title="The vault has no notes yet"
          body="Notes and their connections appear once the knowledge seed runs or memory updates are applied from signed-off documents."
        />
      </SectionCard>
    );
  }

  const shown = counts.nodes.length + (hideUnconnected ? 0 : counts.hiddenUnconnected);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5" role="group" aria-label="Filter the memory graph">
        <SegmentedControl<MemoryTypeGroup> aria-label="Filter by type group" value={group} onValueChange={setGroup} items={typeGroupItems(byType)} />
        <div className="flex h-11 items-center gap-2.5 rounded-[16px] bg-well px-3.5">
          <Switch id={switchId} checked={hideUnconnected} onCheckedChange={setHideUnconnected} />
          <label htmlFor={switchId} className="text-sm whitespace-nowrap text-heading">
            Hide unconnected notes
          </label>
          <span className="text-xs text-muted-foreground tabular-nums" title={`${plural(counts.hiddenUnconnected, "note")} without a visible connection`}>
            {counts.hiddenUnconnected}
          </span>
        </div>
      </div>
      <p className="px-1 text-sm text-muted-foreground" aria-live="polite">
        {shown === data.nodes.length ? plural(shown, "note") : `${shown} of ${plural(data.nodes.length, "note")}`}, {plural(counts.edges.length, "connection")}
      </p>
      <SectionCard>
        <MemoryGraph
          interactive
          data={data}
          typeFilter={types}
          hideUnconnected={hideUnconnected}
          summaries={summaries}
          canvasClassName="h-[360px] sm:h-[460px] lg:h-[560px]"
        />
      </SectionCard>
    </div>
  );
}

function GraphSkeleton({ building }: { building: boolean }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading the memory graph">
      {building && (
        <p role="status" className="flex items-center gap-2.5 px-1 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />
          Building the memory search index — the first build may download a small embeddings model and take a few minutes.
        </p>
      )}
      <Skeleton className="h-11 w-full max-w-xl rounded-[16px]" />
      <div className="card-surface rounded-2xl p-5 sm:p-7" aria-hidden>
        <Skeleton className="h-[360px] w-full rounded-[20px] sm:h-[460px] lg:h-[560px]" />
      </div>
    </div>
  );
}

function OverviewSkeleton({ building }: { building: boolean }) {
  return (
    <div className="flex flex-col gap-6 lg:gap-7" aria-busy="true" aria-label="Loading the memory vault">
      {building && (
        <p role="status" className="flex items-center gap-2.5 px-1 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />
          Building the memory search index — the first build may download a small embeddings model and take a few minutes.
        </p>
      )}
      <CardSkeleton rows={3} />
      <CardSkeleton rows={8} />
    </div>
  );
}

/** Full-page misconfiguration state (plan A7): what was checked, what is missing, how to fix it. */
function VaultMissing({ check, onRetry }: { check: MemoryWorkspaceCheck; onRetry: () => void }) {
  const missing = check.vaultExists ? `No memory CLI at ${check.cliPath}` : `No vault at ${check.vaultDir}`;
  return (
    <SectionCard>
      <ErrorState title="Memory workspace not found" error={missing} onRetry={onRetry} className="pb-2" />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 pb-2">
        <PathRow ok label="Workspace" path={check.workspace} />
        <PathRow ok={check.vaultExists} label="Vault" path={check.vaultDir} />
        <PathRow ok={check.cliExists} label="Memory CLI" path={check.cliPath} />
        <p className="pt-2 text-center text-[13px] leading-5 text-muted-foreground">
          Point <code className="font-mono text-foreground">MEMORY_WORKSPACE</code> (or <code className="font-mono text-foreground">PO_WORKSPACE</code>) in{" "}
          <code className="font-mono text-foreground">.env.local</code> at the po-workspace checkout and restart the dev server.
        </p>
      </div>
    </SectionCard>
  );
}

function PathRow({ ok, label, path }: { ok: boolean; label: string; path: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[14px] bg-well px-3.5 py-2.5 text-[13px]">
      {ok ? (
        <Check aria-hidden className="size-4 shrink-0 text-status-success-fg" strokeWidth={2.25} />
      ) : (
        <X aria-hidden className="size-4 shrink-0 text-status-danger-fg" strokeWidth={2.25} />
      )}
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-mono text-xs text-foreground" title={path}>
        {path}
      </span>
      <span className="sr-only">{ok ? "found" : "missing"}</span>
    </div>
  );
}
