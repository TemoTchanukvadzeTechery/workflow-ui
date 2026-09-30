"use client";

/**
 * The /runs list: every weft run, newest first, with status-group pills, workflow and project
 * filters and a run id search, 50 rows a page. Runs no project owns any more (from deleted
 * projects) are left out unless asked for. A table from 896px of container width, stacked cards
 * below. Only the real workflows carry a badge; the page note says the others are mocks.
 */
import { Activity, ChevronLeft, ChevronRight, Search, SearchX, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type MouseEvent } from "react";
import { EmptyState, ErrorState, IdChip, Money, RelativeTime, SectionCard, SegmentedControl, StatusDot, StatusPill, Tokens, ToolbarGroup, ToolbarText } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRuns } from "@/lib/api/queries";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/weft/labels";
import { WORKFLOW_IDS } from "@/lib/weft/workflows";
import type { RunRow } from "@/lib/weft/types";
import { RunContext, STATUS_GROUPS, WorkflowName, statusGroup, type RunStatusGroup } from "./run-bits";
import type { RunIndex } from "./run-index-types";
import { useRunIndexFor } from "./use-run-index";

export interface RunFilters {
  status?: RunStatusGroup;
  workflow?: string;
  project?: string;
  q?: string;
}

const GROUP_TONE: Record<RunStatusGroup, Tone> = { active: "running", needs_input: "attention", done: "success", failed: "danger" };
const ALL = "__all";
const PAGE_SIZE = 50;

export function RunsTable({ filters, onFiltersChange }: { filters: RunFilters; onFiltersChange: (f: RunFilters) => void }) {
  const runsQ = useRuns({ limit: 500 });
  const runs = useMemo(() => [...(runsQ.data ?? [])].sort((a, b) => b.createdAt - a.createdAt), [runsQ.data]);
  const ids = useMemo(() => runs.map((r) => r.runId), [runs]);
  const indexQ = useRunIndexFor(ids);
  const index = indexQ.data;

  const counts = useMemo(() => {
    const c: Record<RunStatusGroup, number> = { active: 0, needs_input: 0, done: 0, failed: 0 };
    for (const r of runs) c[statusGroup(r.status)]++;
    return c;
  }, [runs]);

  const projects = useMemo(() => {
    const m = new Map<string, string>();
    if (index) for (const e of Object.values(index)) m.set(e.projectId, e.projectName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [index]);

  const workflows = useMemo(() => {
    const set = new Set<string>(WORKFLOW_IDS);
    for (const r of runs) set.add(r.workflow);
    return [...set];
  }, [runs]);

  const [showUnlinked, setShowUnlinked] = useState(false);
  const unlinkedId = useId();
  // Unknown until the index loads, so nothing is hidden before then.
  const isUnlinked = (r: RunRow) => !!index && !index[r.runId];
  const unlinked = runs.filter(isUnlinked).length;

  const q = (filters.q ?? "").trim().toLowerCase();
  const matching = runs.filter((r) => {
    if (filters.status && statusGroup(r.status) !== filters.status) return false;
    if (filters.workflow && r.workflow !== filters.workflow) return false;
    if (filters.project && index?.[r.runId]?.projectId !== filters.project) return false;
    if (q && !r.runId.includes(q) && !(index?.[r.runId]?.taskId ?? "").toLowerCase().includes(q)) return false;
    return true;
  });
  // A run id search finds unlinked runs too; otherwise they only show on request.
  const filtered = showUnlinked || q ? matching : matching.filter((r) => !isUnlinked(r));
  const hiddenUnlinked = matching.length - filtered.length;
  const anyFilter = !!(filters.status || filters.workflow || filters.project || q);
  const set = (patch: Partial<RunFilters>) => onFiltersChange({ ...filters, ...patch });

  // Back to the first page whenever the filters change.
  const pageKey = JSON.stringify([filters, showUnlinked]);
  const [paging, setPaging] = useState({ key: pageKey, page: 0 });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = paging.key === pageKey ? Math.min(paging.page, pages - 1) : 0;
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const goPage = (p: number) => {
    setPaging({ key: pageKey, page: p });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="@container flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3">
        <SegmentedControl<RunStatusGroup | "all">
          aria-label="Filter by status"
          value={filters.status ?? "all"}
          onValueChange={(v) => set({ status: v === "all" ? undefined : v })}
          className="self-start"
          items={[
            { value: "all", label: "All", count: runsQ.isPending ? undefined : runs.length },
            ...STATUS_GROUPS.map((g) => ({
              value: g.id,
              title: g.hint,
              label: (
                <span className="inline-flex items-center gap-2">
                  <StatusDot tone={GROUP_TONE[g.id]} pulse={g.id === "active" && counts.active > 0} size="sm" />
                  {g.label}
                </span>
              ),
              count: runsQ.isPending ? undefined : counts[g.id],
              countTone: g.id === "needs_input" && counts.needs_input > 0 ? ("attention" as const) : g.id === "failed" && counts.failed > 0 ? ("danger" as const) : undefined,
            })),
          ]}
        />
        <div className="flex flex-col gap-2.5 @xl:flex-row @xl:items-center">
          <div className="relative min-w-0 @xl:w-72">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={filters.q ?? ""}
              onChange={(e) => set({ q: e.target.value || undefined })}
              placeholder="Search run id or task"
              aria-label="Search by run id or task id"
              className="pl-10 placeholder:font-sans [&:not(:placeholder-shown)]:font-mono"
            />
          </div>
          <ToolbarGroup aria-label="Filter by workflow and project" className="w-full @xl:w-auto">
            <Select value={filters.workflow ?? ALL} onValueChange={(v) => set({ workflow: v === ALL ? undefined : v })}>
              <SelectTrigger aria-label="Filter by workflow" className="min-w-0 flex-1 @xl:w-44 @xl:flex-none">
                <SelectValue placeholder="All workflows" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All workflows</SelectItem>
                {workflows.map((w) => (
                  <SelectItem key={w} value={w}>
                    <span className="font-mono text-[13px]">{w}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ToolbarText className="hidden @md:inline">in</ToolbarText>
            <Select value={filters.project ?? ALL} onValueChange={(v) => set({ project: v === ALL ? undefined : v })}>
              <SelectTrigger aria-label="Filter by project" className="min-w-0 flex-1 @xl:w-60 @xl:flex-none">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All projects</SelectItem>
                {projects.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ToolbarGroup>
          {anyFilter && (
            <Button variant="ghost" size="sm" className="w-fit text-muted-foreground" onClick={() => onFiltersChange({})}>
              <X aria-hidden />
              Clear filters
            </Button>
          )}
          {unlinked > 0 && !filters.project ? (
            <div className="flex h-9 items-center gap-2 px-1 @xl:ml-auto">
              <Switch id={unlinkedId} checked={showUnlinked} onCheckedChange={setShowUnlinked} />
              <label htmlFor={unlinkedId} className="text-[13px] whitespace-nowrap text-muted-foreground" title="Runs of projects that were deleted">
                Show {plural(unlinked, "unlinked run")}
              </label>
            </div>
          ) : null}
          <span className={cn("text-[13px] text-muted-foreground", !(unlinked > 0 && !filters.project) && "@xl:ml-auto")} aria-live="polite">
            {runsQ.isPending ? "" : `${plural(filtered.length, "run")}${anyFilter || hiddenUnlinked ? ` of ${runs.length}` : ""}`}
          </span>
        </div>
      </div>

      {runsQ.isPending ? (
        <SectionCard flush>
          <TableSkeleton />
        </SectionCard>
      ) : runsQ.error ? (
        <SectionCard>
          <ErrorState title="Could not load runs" error={runsQ.error} onRetry={() => void runsQ.refetch()} />
        </SectionCard>
      ) : runs.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={Activity}
            title="No runs yet"
            body="A run appears here as soon as a project starts po-brd, architect-aad or an implementation agent."
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href="/projects">Open projects</Link>
              </Button>
            }
          />
        </SectionCard>
      ) : filtered.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={SearchX}
            title="No runs match these filters"
            body={
              q ? (
                <>
                  Nothing matches <span className="font-mono">{q}</span>.
                </>
              ) : hiddenUnlinked ? (
                `${plural(hiddenUnlinked, "unlinked run")} hidden; turn on "Show unlinked runs" to see them.`
              ) : (
                "Try another status, workflow or project."
              )
            }
            action={
              <Button variant="secondary" size="sm" onClick={() => onFiltersChange({})}>
                Clear filters
              </Button>
            }
          />
        </SectionCard>
      ) : (
        <>
          <SectionCard flush className="hidden @4xl:flex">
            <RunsGrid runs={pageRows} index={index} indexPending={indexQ.isPending} />
          </SectionCard>
          <ul className="flex flex-col gap-2 @4xl:hidden" aria-label="Runs">
            {pageRows.map((r) => (
              <li key={r.runId}>
                <RunCard run={r} index={index} />
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] text-muted-foreground tabular-nums">
                {page * PAGE_SIZE + 1}–{Math.min(filtered.length, (page + 1) * PAGE_SIZE)} of {filtered.length}
              </span>
              <span className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => goPage(page - 1)}>
                  <ChevronLeft aria-hidden />
                  Newer
                </Button>
                <span className="text-[13px] text-muted-foreground tabular-nums">
                  Page {page + 1} of {pages}
                </span>
                <Button variant="secondary" size="sm" disabled={page >= pages - 1} onClick={() => goPage(page + 1)}>
                  Older
                  <ChevronRight aria-hidden />
                </Button>
              </span>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

function openRow(router: ReturnType<typeof useRouter>, runId: string) {
  return (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("a,button")) return;
    if (e.metaKey || e.ctrlKey) {
      window.open(`/runs/${runId}`, "_blank", "noopener");
      return;
    }
    router.push(`/runs/${runId}`);
  };
}

function RunsGrid({ runs, index, indexPending }: { runs: RunRow[]; index: RunIndex | undefined; indexPending: boolean }) {
  const router = useRouter();
  return (
    <Table className="text-sm">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[140px] pl-5">Status</TableHead>
          <TableHead>Workflow</TableHead>
          <TableHead>Run</TableHead>
          <TableHead>Project · stage</TableHead>
          <TableHead className="text-right">Steps</TableHead>
          <TableHead className="text-right">Spend</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
          <TableHead className="hidden text-right @5xl:table-cell">Created</TableHead>
          <TableHead className="pr-5 text-right">Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((r) => (
          <TableRow key={r.runId} className="h-[52px] cursor-pointer" onClick={openRow(router, r.runId)}>
            <TableCell className="pl-5">
              <StatusPill status={{ kind: "run", value: r.status }} size="sm" />
            </TableCell>
            <TableCell className="max-w-[200px]">
              <WorkflowName workflow={r.workflow} href={`/runs/${r.runId}`} badges="real" />
            </TableCell>
            <TableCell>
              <IdChip id={r.runId} size="sm" href={`/runs/${r.runId}`} />
            </TableCell>
            <TableCell>
              <div className="flex max-w-[260px] min-w-0 @6xl:max-w-[340px]">{indexPending ? <Skeleton className="h-4 w-40" /> : <RunContext entry={index?.[r.runId]} stacked />}</div>
            </TableCell>
            <TableCell className="text-right font-mono text-xs tabular-nums">{r.steps ?? "-"}</TableCell>
            <TableCell className="text-right">
              <Money usd={r.spend?.usd} className="font-mono text-xs" />
            </TableCell>
            <TableCell className="text-right">
              <Tokens n={r.spend?.tokens} compact className="text-xs text-muted-foreground" />
            </TableCell>
            <TableCell className="hidden text-right text-xs text-muted-foreground @5xl:table-cell">
              <RelativeTime at={r.createdAt} />
            </TableCell>
            <TableCell className="pr-5 text-right text-xs text-muted-foreground">
              <RelativeTime at={r.updatedAt} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RunCard({ run: r, index }: { run: RunRow; index: RunIndex | undefined }) {
  const router = useRouter();
  return (
    <div onClick={openRow(router, r.runId)} className="card-surface flex cursor-pointer flex-col gap-2.5 rounded-[20px] px-4 py-3.5 transition-shadow hover:shadow-[var(--card-edge),0_20px_40px_-18px_rgb(0_0_0/0.18)]">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <WorkflowName workflow={r.workflow} href={`/runs/${r.runId}`} badges="real" />
        <StatusPill status={{ kind: "run", value: r.status }} size="sm" />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <IdChip id={r.runId} size="sm" href={`/runs/${r.runId}`} />
        <RunContext entry={index?.[r.runId]} className="text-xs" wrap />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground tabular-nums">
        <span>{plural(r.steps ?? 0, "step")}</span>
        {r.running ? (
          <span className="inline-flex items-center gap-1 text-status-running-fg">
            <StatusDot tone="running" pulse size="sm" /> {r.running} running
          </span>
        ) : null}
        <Tokens n={r.spend?.tokens} compact />
        <Money usd={r.spend?.usd} />
        <span className="font-sans">
          <RelativeTime at={r.updatedAt} prefix="updated" />
        </span>
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col divide-y" aria-busy="true" aria-label="Loading runs">
      <div className="flex h-10 items-center gap-6 px-5">
        {[80, 120, 70, 180, 40, 50].map((w, i) => (
          <Skeleton key={i} className="h-3" style={{ width: w }} />
        ))}
      </div>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex h-11 items-center gap-6 px-5">
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-4 w-52" />
          <span className="flex-1" />
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
  );
}
