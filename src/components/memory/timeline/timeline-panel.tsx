"use client";

/**
 * The Timeline tab on /memory (plan §4): the vault's git history, newest first. Top to bottom: a
 * summary strip (commits, sign-offs, notes touched, last change, and `main · <short head>`, the
 * slot a branch switcher fills later), the All · Sign-offs · Edits filter (`?kind=`), the
 * uncommitted band when the working tree differs from HEAD, a weekly chart once six or more weeks
 * have commits, and the day-grouped rail with "Show older" down to "Start of vault history". The
 * diff drawer is deep-linkable: `?commit=<short sha|working>&file=<memory/…>`. Every param is
 * written with history.replaceState, keeping the others (`view`, `q`).
 */
import { format } from "date-fns";
import { BadgeCheck, GitBranch, GitCommitHorizontal, History, Loader2, PencilLine, Sprout } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo, type ReactNode } from "react";
import { EmptyState, ErrorState, FactCell, FactStrip, RelativeTime, SectionCard, SegmentedControl, type SegmentedItem } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StepAreaChart } from "@/components/viz";
import { useMemoryOverview, useMemoryTimeline, useProjects } from "@/lib/api/queries";
import { formatNumber, plural } from "@/lib/format";
import { isMemoryTimelineKind, MEMORY_WORKING_SHA, type MemoryGitState, type MemoryTimelineKind, type MemoryTimelineSummary } from "@/lib/memory/types";
import { CommitDiffSheet, type CommitDiffTarget } from "./commit-diff-sheet";
import { defaultDiffFile } from "./event-headline";
import { TimelineRail, type ViewDiff } from "./timeline-rail";
import { UncommittedBand } from "./uncommitted-band";

/** The weekly chart only once there is a shape to see. */
const MIN_ACTIVE_WEEKS = 6;
const COMMIT_PARAM_RE = /^(?:[0-9a-f]{7,64}|working)$/;

type Params = Partial<Record<"kind" | "commit" | "file", string | null>>;

/** `?kind=`, `?commit=` and `?file=`, and a writer that rewrites them in place (no navigation). */
function useTimelineParams() {
  const params = useSearchParams();
  const pathname = usePathname();
  const rawKind = params.get("kind");
  const kind: MemoryTimelineKind = rawKind && isMemoryTimelineKind(rawKind) ? rawKind : "all";
  const commit = params.get("commit");
  const file = params.get("file");
  const target: CommitDiffTarget | null = commit && COMMIT_PARAM_RE.test(commit) ? { sha: commit, file: file?.startsWith("memory/") ? file : null } : null;

  const write = useCallback(
    (patch: Params) => {
      const sp = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined) sp.delete(key);
        else sp.set(key, value);
      }
      const qs = sp.toString();
      // history.replaceState syncs useSearchParams without a server round trip (Next docs, "Native History API").
      window.history.replaceState(null, "", `${pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
    },
    [pathname],
  );
  return { kind, target, write };
}

function kindItems(summary: MemoryTimelineSummary | undefined): Array<SegmentedItem<MemoryTimelineKind>> {
  return [
    { value: "all", label: "All", icon: History, count: summary?.commits },
    { value: "signoff", label: "Sign-offs", icon: BadgeCheck, count: summary?.signoffs },
    { value: "edit", label: "Edits", icon: PencilLine, count: summary ? summary.commits - summary.signoffs : undefined },
  ];
}

/** `main · 82b23e7`; the slot the memory branch switcher (plan A12) will fill. */
function BranchSlot({ git }: { git: Extract<MemoryGitState, { ok: true }> }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <GitBranch aria-hidden className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
      <span className="truncate">{git.branch ?? "detached HEAD"}</span>
      <span aria-hidden className="text-muted-foreground">
        ·
      </span>
      <span className="font-mono text-[13px]">{git.shortHead ?? "no commits"}</span>
    </span>
  );
}

function SummaryStrip({ summary, git }: { summary: MemoryTimelineSummary | undefined; git: Extract<MemoryGitState, { ok: true }> }) {
  const last = summary?.lastChangeAt ? Date.parse(summary.lastChangeAt) : NaN;
  return (
    <FactStrip>
      <FactCell label="Commits" value={summary ? formatNumber(summary.commits) : null} numeric />
      <FactCell label="Sign-offs" value={summary ? formatNumber(summary.signoffs) : null} numeric />
      <FactCell label="Notes touched" value={summary ? formatNumber(summary.notesTouched) : null} numeric />
      <FactCell label="Last change" value={Number.isFinite(last) ? <RelativeTime at={last} /> : null} />
      <FactCell label="Branch" value={<BranchSlot git={git} />} />
    </FactStrip>
  );
}

function WeeklyChart({ weeks }: { weeks: MemoryTimelineSummary["weeks"] }) {
  const peak = weeks.reduce((best, w, i) => (w.commits > (weeks[best]?.commits ?? 0) ? i : best), 0);
  return (
    <SectionCard density="dense" title="Commits per week" description="First-parent commits that changed the vault">
      <StepAreaChart
        data={weeks.map((w) => ({ label: `Week of ${format(new Date(`${w.week}T00:00:00`), "MMM d")}`, value: w.commits }))}
        xLabels={thinWeekLabels(weeks)}
        highlightIndex={peak}
        chipLabel={plural(weeks[peak]?.commits ?? 0, "commit")}
        height={200}
        formatValue={(v) => plural(v, "commit")}
        ariaLabel="Vault commits per week"
      />
    </SectionCard>
  );
}

/** About five evenly spread "Sep 28" labels under the chart. */
function thinWeekLabels(weeks: MemoryTimelineSummary["weeks"], want = 5): string[] {
  const label = (w: { week: string }) => format(new Date(`${w.week}T00:00:00`), "MMM d");
  if (weeks.length <= want) return weeks.map(label);
  const step = (weeks.length - 1) / (want - 1);
  return Array.from({ length: want }, (_, i) => label(weeks[Math.round(i * step)]));
}

function gitUnavailableBody(git: Extract<MemoryGitState, { ok: false }>): string {
  if (git.reason === "no-git") return "git is not installed (or not on the server's PATH), so the vault's history cannot be read.";
  if (git.reason === "not-a-repo") return "The po-workspace is not a git repository, so the vault has no history to show.";
  return git.message;
}

function EmptyHistory({ kind }: { kind: MemoryTimelineKind }) {
  if (kind === "signoff") {
    return (
      <EmptyState
        icon={BadgeCheck}
        title="No sign-offs yet"
        body={
          <>
            When a PO signs a project off, its memory updates are committed as <span className="font-mono text-foreground">memory: sign-off of &lt;project&gt;</span> and appear here.
          </>
        }
      />
    );
  }
  if (kind === "edit") return <EmptyState icon={GitCommitHorizontal} title="No edits" body="Only sign-off commits have changed the vault so far." />;
  return <EmptyState icon={History} title="No commits yet" body="The vault's history starts with the first commit that changes memory/." />;
}

/** The filter stays live while a newly picked kind loads. */
function TimelineSkeleton({ filter }: { filter: ReactNode }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading the vault timeline">
      <Skeleton className="h-[74px] w-full rounded-[20px]" />
      <div className="flex flex-wrap items-center justify-between gap-3">{filter}</div>
      <div className="card-surface flex flex-col gap-5 rounded-2xl p-5 sm:p-7" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3.5">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-72 max-w-full" />
              <Skeleton className="h-3.5 w-52 max-w-full" />
              <Skeleton className="h-6 w-40 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MemoryTimelinePanel() {
  const { kind, target, write } = useTimelineParams();
  const timeline = useMemoryTimeline(kind);
  // Titles and "(removed)" come from the overview the Table tab already caches.
  const overview = useMemoryOverview();
  const projects = useProjects();
  const notes = useMemo(() => (overview.data ? new Map(overview.data.notes.map((n) => [n.card.id, n.card.title])) : undefined), [overview.data]);
  const projectIds = useMemo(() => new Set((projects.data ?? []).map((p) => p.id)), [projects.data]);

  const openDiff: ViewDiff = (event, file) =>
    write({ commit: event.kind === "uncommitted" ? MEMORY_WORKING_SHA : event.shortSha, file: file === undefined ? defaultDiffFile(event) : file });
  const sheet = <CommitDiffSheet target={target} onFileChange={(file) => write({ file })} onClose={() => write({ commit: null, file: null })} />;
  const filter = (summary: MemoryTimelineSummary | undefined) => (
    <SegmentedControl<MemoryTimelineKind> aria-label="Filter the timeline" value={kind} onValueChange={(k) => write({ kind: k === "all" ? null : k })} items={kindItems(summary)} />
  );

  if (timeline.isPending) {
    return (
      <>
        <TimelineSkeleton filter={filter(undefined)} />
        {sheet}
      </>
    );
  }
  const data = timeline.data;
  if (!data) {
    return (
      <>
        <SectionCard>
          <ErrorState title="Could not load the vault timeline" error={timeline.error ?? undefined} onRetry={() => void timeline.refetch()} />
        </SectionCard>
        {sheet}
      </>
    );
  }

  const first = data.pages[0];
  const git = first?.git;
  if (!first || !git || !git.ok) {
    return (
      <>
        <SectionCard>
          <EmptyState icon={GitBranch} title="No git history for the vault" body={git && !git.ok ? gitUnavailableBody(git) : undefined} />
        </SectionCard>
        {sheet}
      </>
    );
  }

  const summary = first.summary;
  const working = first.working;
  const events = data.pages.flatMap((p) => p.events);
  const complete = !timeline.hasNextPage;
  // "Vault seeded" names the oldest bulk import, which is only known once the whole history is loaded.
  const seededSha = complete ? ([...events].reverse().find((e) => e.bulk && e.kind !== "signoff")?.sha ?? null) : null;
  const activeWeeks = summary?.weeks.filter((w) => w.commits > 0).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <SummaryStrip summary={summary} git={git} />
      <div className="flex flex-wrap items-center justify-between gap-3">{filter(summary)}</div>
      {working ? <UncommittedBand event={working} onViewChanges={() => openDiff(working)} /> : null}
      {summary && activeWeeks >= MIN_ACTIVE_WEEKS ? <WeeklyChart weeks={summary.weeks} /> : null}
      <SectionCard>
        {events.length === 0 ? (
          <EmptyHistory kind={kind} />
        ) : (
          <div className="flex flex-col gap-2">
            <TimelineRail events={events} seededSha={seededSha} notes={notes} projectIds={projectIds} onViewDiff={openDiff} />
            <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4">
              {timeline.hasNextPage ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => void timeline.fetchNextPage()} disabled={timeline.isFetchingNextPage}>
                  {timeline.isFetchingNextPage ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
                  {timeline.isFetchingNextPage ? "Loading older commits…" : "Show older"}
                </Button>
              ) : git.shallow ? (
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <GitBranch aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
                  History stops here: the po-workspace is a shallow clone, so older commits are not on this machine.
                </p>
              ) : (
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Sprout aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
                  Start of vault history
                </p>
              )}
              {timeline.isFetchNextPageError ? (
                <p role="alert" className="text-[13px] text-status-danger-fg">
                  Could not load older commits{timeline.error ? `: ${timeline.error.message}` : ""}.
                </p>
              ) : null}
            </div>
          </div>
        )}
      </SectionCard>
      {sheet}
    </div>
  );
}
