"use client";

/**
 * The frame every stage workspace shares: a big header (row 1: Stage n of 5 · Title with a
 * copy-link circle, full width; row 2: owner, status and metric as chips on the left, the stage's
 * runs as a toolbar group, header actions and Reopen on the right; then the sub-steps as a
 * segmented control), the main column, a right rail card with Requests /
 * Notes / Activity (stacked below on narrow screens) and the GateFooter band. The rail folds to a thin tab strip while it holds no
 * request or note of its own, so it does not take 360px from the page to say "nothing here".
 * Locked stages show LockedStage and keep any existing content, and its sub-steps, read-only.
 */
import { useQueries } from "@tanstack/react-query";
import { ArrowLeft, Check, History, Inbox, Link2, PanelRightClose, StickyNote, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CircleIconButton, FloatingChip, SegmentedControl, StatusPill, ToolbarGroup, ToolbarText, type SegmentedItem } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/use-copy";
import { weft } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import { STAGES, stageDef, type ProjectBundle, type StageId, type StageStatus } from "@/lib/delivery/types";
import { TERMINAL_RUN_STATUSES, type RunStatus } from "@/lib/weft/types";
import { cn } from "@/lib/utils";
import { actorName, TimeAgo } from "../hitl/bits";
import { RequestList } from "../hitl/RequestList";
import { GateFooter, type GateNextAction } from "./GateFooter";
import { blockerActionLabel, nextActionLabel } from "./next-action";
import { NotesPanel, type NoteAnchorOption } from "./NotesPanel";
import { RunChip } from "./RunChip";
import { LockedStage, ReopenDialog, StaleBanner } from "./StageBanners";

export interface StageStep {
  id: string;
  label: string;
  disabled?: boolean;
  /** "4/5" (progress, neutral) or a bare count such as 2 (things waiting on you, amber). */
  badge?: ReactNode;
}

export interface StageLayoutProps {
  projectId: string;
  stage: StageId;
  bundle: ProjectBundle;
  steps: StageStep[];
  activeStep: string;
  onStepChange: (id: string) => void;
  children: ReactNode;
  /** Extra rail content above the tabs. */
  railExtra?: ReactNode;
  gate?: { approveLabel: string; hide?: boolean };
  headerActions?: ReactNode;
  /** Runs whose requests the stage view renders inline; the rail leaves them out. */
  hideRequestsFor?: string[];
  /** "<runId>:<hId>" from ?request=, focused in the rail. */
  focusRequest?: string;
  anchorOptions?: NoteAnchorOption[];
  /** Keep ?step= in the URL in sync (default true). */
  syncStepToUrl?: boolean;
}

type RailTab = "requests" | "notes" | "activity";

/** Stage states in which a person has something to do before the gate can open. */
const ACTION_DUE: ReadonlySet<StageStatus> = new Set<StageStatus>(["needs_input", "not_started", "failed"]);
const LIVE_RUN: ReadonlySet<RunStatus> = new Set<RunStatus>(["planning", "executing", "integrating", "verifying"]);

function defaultApproveLabel(stage: StageId): string {
  const def = stageDef(stage);
  if (stage === "signoff") return "Sign off & mark done";
  const next = STAGES.find((s) => s.n === def.n + 1);
  return next ? `Approve & move to ${next.title}` : "Approve";
}

/** A run chip's status repeats the header pill when both say "needs input" or both say "running". */
function repeatsStageStatus(stage: StageStatus, run: RunStatus): boolean {
  return (stage === "needs_input" && run === "waiting_for_human") || (stage === "in_progress" && LIVE_RUN.has(run));
}

/**
 * One rule for every stage's step badges: "x/y" is progress (a muted number), a bare count waits
 * on you (an amber chip) while the stage is open. On an approved, locked or done stage nothing
 * waits, so every count is muted there.
 */
function stepItem(s: StageStep, open: boolean): SegmentedItem {
  const text = typeof s.badge === "number" || typeof s.badge === "string" ? String(s.badge).trim() : null;
  if (text !== null && /^\d+$/.test(text)) {
    const n = Number(text);
    const waits = open && n > 0;
    return {
      value: s.id,
      label: s.label,
      count: n,
      countTone: waits ? "attention" : undefined,
      disabled: s.disabled,
      ariaLabel: waits ? `${s.label}, ${n} waiting on you` : `${s.label}, ${n}`,
      title: waits ? `${n} waiting on you` : undefined,
    };
  }
  if (s.badge === undefined || s.badge === null || text === "") return { value: s.id, label: s.label, disabled: s.disabled };
  return {
    value: s.id,
    label: (
      <>
        {s.label}
        <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">{s.badge}</span>
      </>
    ),
    disabled: s.disabled,
    ariaLabel: text !== null ? `${s.label}, ${text}` : undefined,
  };
}

function StepPills({ steps, active, onChange, open }: { steps: StageStep[]; active: string; onChange: (id: string) => void; open: boolean }) {
  const navRef = useRef<HTMLElement>(null);
  // On narrow screens the segments scroll sideways; keep the active one in view (horizontally only, so the page never jumps).
  useEffect(() => {
    const track = navRef.current?.querySelector<HTMLElement>('[data-slot="segmented-control"]');
    const el = track?.querySelector<HTMLElement>('[data-state="on"]');
    if (!track || !el) return;
    const n = track.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    if (e.left < n.left) track.scrollLeft += e.left - n.left - 8;
    else if (e.right > n.right) track.scrollLeft += e.right - n.right + 8;
  }, [active]);
  if (steps.length === 0) return null;
  return (
    // relative: the scroll box contains its absolutely placed sr-only text, which would otherwise widen the page.
    <nav ref={navRef} aria-label="Stage steps" className="relative max-w-full min-w-0">
      <SegmentedControl
        role="tablist"
        aria-label="Stage steps"
        value={active}
        onValueChange={onChange}
        items={steps.map((s) => stepItem(s, open))}
        itemClassName="px-3 @2xl/stage:px-4"
      />
    </nav>
  );
}

function ActivityList({ items }: { items: ProjectBundle["activity"] }) {
  if (items.length === 0) return <p className="rounded-[20px] bg-well/60 px-4 py-8 text-center text-[13px] text-muted-foreground">No activity yet.</p>;
  return (
    <ol className="-mx-1 divide-y divide-rule">
      {items.map((a) => {
        const body = (
          <>
            <span className="block text-sm leading-5 text-foreground">{a.text}</span>
            <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              <span>{actorName(a.actor)}</span>
              <TimeAgo at={a.at} />
              {a.runId ? <span className="font-mono">{a.runId}</span> : null}
            </span>
          </>
        );
        return (
          <li key={a.id}>
            {a.href ? (
              <Link href={a.href} className="block rounded-[12px] px-2 py-2.5 transition-colors hover:bg-foreground/[0.03] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                {body}
              </Link>
            ) : (
              <div className="px-2 py-2.5">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The folded rail: a well track of icon buttons (with counts), vertical beside the page, a row below it on narrow screens. */
function RailStrip({ tabs, onOpen }: { tabs: Array<{ id: RailTab; label: string; icon: LucideIcon; count: number; attention?: boolean }>; onOpen: (tab: RailTab) => void }) {
  return (
    <div role="toolbar" aria-label="Side panel" className="flex w-fit gap-1 rounded-[16px] bg-well p-1 @4xl/stage:flex-col">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onOpen(t.id)}
          title={`${t.label}${t.count ? ` (${t.count})` : ""}`}
          aria-label={`Open ${t.label}${t.count ? `, ${t.count}` : ""}`}
          className="relative inline-flex h-9 items-center gap-1.5 rounded-[12px] px-3 text-[13px] font-medium text-muted-foreground transition-[color,background-color,box-shadow] duration-150 outline-none hover:bg-raised hover:text-heading hover:shadow-(--raised-shadow) focus-visible:ring-3 focus-visible:ring-ring/50 @4xl/stage:size-10 @4xl/stage:justify-center @4xl/stage:px-0"
        >
          <t.icon aria-hidden className="size-[18px] shrink-0" strokeWidth={1.75} />
          <span className="@4xl/stage:sr-only">{t.label}</span>
          {t.count > 0 ? (
            <span
              aria-hidden
              className={cn(
                "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10.5px] leading-none font-semibold tabular-nums @4xl/stage:absolute @4xl/stage:-top-1 @4xl/stage:-right-1 @4xl/stage:ring-2 @4xl/stage:ring-well",
                t.attention ? "bg-status-attention-bg text-status-attention-fg" : "bg-raised text-muted-foreground",
              )}
            >
              {t.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** The circle "copy link" button beside the stage title, as the reference has beside "Overview". */
function CopyStageLink({ stage, step }: { stage: string; step: string }) {
  const { copied, copy } = useCopy();
  return (
    <CircleIconButton
      variant="raised"
      size="sm"
      icon={copied ? Check : Link2}
      label={copied ? "Link copied" : `Copy a link to ${stage}`}
      title={copied ? "Copied" : "Copy link"}
      onClick={() => {
        const url = new URL(window.location.href);
        url.search = step ? `?step=${encodeURIComponent(step)}` : "";
        void copy(url.toString(), "the link");
      }}
    />
  );
}

export function StageLayout({
  projectId,
  stage,
  bundle,
  steps,
  activeStep,
  onStepChange,
  children,
  railExtra,
  gate,
  headerActions,
  hideRequestsFor,
  focusRequest,
  anchorOptions,
  syncStepToUrl = true,
}: StageLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const def = stageDef(stage);
  const view = bundle.stages[stage];
  const record = bundle.project.stages[stage];
  const locked = view.status === "locked";
  const done = bundle.project.done;
  const hidden = new Set(hideRequestsFor ?? []);
  const focusInRail = !!focusRequest && !hidden.has(focusRequest.split(":")[0]);
  // null until the person picks a tab: then Requests while the rail lists something, else Notes.
  const [pickedTab, setRailTab] = useState<RailTab | null>(focusInRail ? "requests" : null);
  // null until the person folds or unfolds the rail: then open while it has something of its own.
  const [pickedOpen, setRailOpen] = useState<boolean | null>(focusInRail ? true : null);
  // A later ?request= (e.g. a toast link while the page is open) must bring the Requests tab forward.
  const [seenFocus, setSeenFocus] = useState(focusRequest);
  if (focusRequest !== seenFocus) {
    setSeenFocus(focusRequest);
    if (focusRequest && focusInRail) {
      setRailTab("requests");
      setRailOpen(true);
    }
  }

  const railId = useId();

  const changeStep = (id: string) => {
    onStepChange(id);
    if (!syncStepToUrl) return;
    // Read the live query string so other params (?request=) survive; avoids useSearchParams' Suspense requirement.
    const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    params.set("step", id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const liveRunIds = view.runs.filter((r) => !TERMINAL_RUN_STATUSES.includes(r.status)).map((r) => r.runId);
  // The Requests tab count must match what the rail lists: leave out the runs the page answers inline.
  const railRunIds = liveRunIds.filter((id) => !hidden.has(id));
  const railPending = useQueries({ queries: railRunIds.map((runId) => ({ queryKey: qk.runPending(runId), queryFn: () => weft.runPending(runId) })) });
  const railKeys = new Set<string>();
  for (const q of railPending) for (const r of q.data ?? []) if (r.kind !== "gate" && !hidden.has(r.runId)) railKeys.add(`${r.runId}:${r.id}`);
  const railCount = hidden.size > 0 ? railKeys.size : view.pending;
  const activity = bundle.activity.filter((a) => a.stage === stage).sort((a, b) => b.at - a.at);
  const railTab: RailTab = pickedTab ?? (railCount > 0 ? "requests" : "notes");
  // Activity alone does not keep the rail open: it logs what the page already shows.
  const railOpen = pickedOpen ?? (railCount > 0 || record.notes.length > 0);
  const openRail = (tab: RailTab) => {
    setRailTab(tab);
    setRailOpen(true);
  };

  const prevStage = STAGES.find((s) => s.n === def.n - 1);
  const recentRuns = [...view.runs].sort((a, b) => b.createdAt - a.createdAt);
  const shownRuns = recentRuns.slice(0, 3);
  const hasContent = view.runs.length > 0 || !!record.imported || !!record.stale;
  // Approved, locked or done: notes are read-only and nothing on the stage waits on anyone.
  const closed = done || locked || view.status === "approved";

  // The gate's primary control while blockers remain: the project's next step when it is on this
  // stage, else the first blocker that links to where it is resolved.
  const linked = view.blockerItems?.find((b) => b.href);
  const ns = bundle.nextStep;
  const nextAction: GateNextAction | undefined =
    !done && view.blockers.length > 0 && ACTION_DUE.has(view.status)
      ? ns && ns.stage === stage
        ? { label: nextActionLabel(ns.text), href: ns.href, title: ns.text }
        : linked?.href
          ? { label: blockerActionLabel(linked.text), href: linked.href, title: linked.text }
          : undefined
      : undefined;
  // Nothing to change before the stage produced anything; PO Review can always send back.
  const canRequestChanges = view.status !== "not_started" && (stage === "signoff" || view.runs.length > 0 || !!record.imported);

  const railTabs = [
    { id: "requests" as const, label: "Requests", icon: Inbox, count: railCount, attention: true },
    { id: "notes" as const, label: "Notes", icon: StickyNote, count: record.notes.length },
    { id: "activity" as const, label: "Activity", icon: History, count: activity.length },
  ];

  return (
    <div className="@container/stage flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-5">
        {/* Row 1: the title and its copy-link circle get the full width, so a long title never wraps against the toolbar. */}
        <div className="flex min-w-0 items-start gap-2.5">
          <h1 className="min-w-0 text-[32px] leading-[1.08] font-normal tracking-[-0.03em] break-words text-heading @2xl/stage:text-[44px] @2xl/stage:leading-[1.05] @2xl/stage:tracking-[-0.035em] @6xl/stage:text-[52px]">
            <span className="text-muted-label">Stage {def.n} of 5 · </span>
            {def.title}
          </h1>
          <div className="shrink-0 pt-1 @2xl/stage:pt-2">
            <CopyStageLink stage={def.title} step={activeStep} />
          </div>
        </div>
        {/* Row 2: owner, status and metric on the left; the runs, actions and Reopen on the right. When both do not fit on one line, the right group wraps below whole. */}
        <div className="-mt-1 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <FloatingChip label="Owner" value={def.owner} icon={UserRound} title="Informational only: no roles yet, anyone can act" />
            <StatusPill status={{ kind: "stage", value: view.status }} variant="chip" />
            {view.metric ? <span className="px-1 text-[15px] text-muted-foreground">{view.metric}</span> : null}
          </div>
          {shownRuns.length > 0 || headerActions || view.status === "approved" ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {shownRuns.length > 0 ? (
                <ToolbarGroup aria-label="Runs of this stage">
                  {shownRuns.map((r) => (
                    <RunChip key={r.runId} variant="segment" runId={r.runId} workflow={r.workflow} status={r.status} quiet={repeatsStageStatus(view.status, r.status)} />
                  ))}
                  {recentRuns.length > shownRuns.length ? (
                    <ToolbarText>
                      <Link href={`/runs?project=${encodeURIComponent(projectId)}`} className="rounded-sm hover:text-heading focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                        +{recentRuns.length - shownRuns.length} more
                      </Link>
                    </ToolbarText>
                  ) : null}
                </ToolbarGroup>
              ) : null}
              {headerActions}
              {/* Also on done projects: reopening a stage takes the project out of Done. */}
              {view.status === "approved" ? <ReopenDialog projectId={projectId} stage={stage} /> : null}
            </div>
          ) : null}
        </div>
        {/* A locked stage keeps its sub-steps so what was kept stays reachable, read-only. */}
        {steps.length > 0 && (!locked || hasContent) ? <StepPills steps={steps} active={activeStep} onChange={changeStep} open={!closed} /> : null}
      </header>

      {record.stale ? <StaleBanner stale={record.stale} approvedBefore={record.decisions.some((d) => d.decision === "approved")} /> : null}

      <div className={cn("grid min-w-0 gap-5", railOpen ? "@4xl/stage:grid-cols-[minmax(0,1fr)_360px]" : "@4xl/stage:grid-cols-[minmax(0,1fr)_auto]")}>
        <section className="min-w-0 space-y-5" aria-label={`${def.title} workspace`} data-stage-workspace="">
          {locked ? (
            <>
              <LockedStage stage={stage}>
                {prevStage ? (
                  <Button asChild variant="secondary" size="sm" className="mt-2">
                    <Link href={`/projects/${encodeURIComponent(projectId)}/${prevStage.id}`}>
                      <ArrowLeft aria-hidden />
                      Go to {prevStage.title}
                    </Link>
                  </Button>
                ) : null}
              </LockedStage>
              {hasContent ? (
                <div inert className="pointer-events-none opacity-60 select-none">
                  {children}
                </div>
              ) : null}
            </>
          ) : (
            children
          )}
        </section>

        {/* Sticky rail sized to end above the sticky GateFooter band (top 4rem + band ~6.5rem + gaps), so its bottom is never hidden. */}
        <aside
          className="min-w-0 space-y-3 @4xl/stage:sticky @4xl/stage:top-16 @4xl/stage:max-h-[calc(100vh-12rem)] @4xl/stage:self-start @4xl/stage:overflow-y-auto @4xl/stage:overscroll-contain @4xl/stage:rounded-2xl"
          aria-label={`${def.title} side panel`}
        >
          {railExtra}
          {railOpen ? (
            <div className="card-surface flex min-w-0 flex-col gap-3.5 rounded-2xl p-3">
              {/* Segments size to their labels (never truncated); the track fills what the fold circle leaves. */}
              <div className="flex items-center gap-1.5">
                <SegmentedControl
                  role="tablist"
                  aria-label="Side panel"
                  size="sm"
                  fullWidth
                  className="min-w-0 flex-1"
                  itemClassName="min-w-fit flex-auto px-2.5"
                  value={railTab}
                  onValueChange={(v) => setRailTab(v)}
                  items={[
                    { value: "requests", label: "Requests", id: `${railId}-requests`, controls: `${railId}-panel`, ...(railCount > 0 ? { count: railCount, countTone: "attention" as const } : {}) },
                    { value: "notes", label: "Notes", id: `${railId}-notes`, controls: `${railId}-panel`, ...(record.notes.length > 0 ? { count: record.notes.length } : {}) },
                    { value: "activity", label: "Activity", id: `${railId}-activity`, controls: `${railId}-panel` },
                  ]}
                />
                <CircleIconButton size="md" variant="ghost" icon={PanelRightClose} label="Fold the side panel" title="Fold the side panel" className="text-muted-foreground" onClick={() => setRailOpen(false)} />
              </div>
              <div id={`${railId}-panel`} role="tabpanel" aria-labelledby={`${railId}-${railTab}`} className="min-w-0 px-0.5">
                {railTab === "requests" ? (
                  <RequestList runIds={liveRunIds} projectId={projectId} hideRunIds={hideRequestsFor} focus={focusRequest} compact emptyText={hideRequestsFor?.length ? "Nothing else is waiting; open requests are shown in the page." : "Nothing in this stage is waiting on a person."} />
                ) : railTab === "notes" ? (
                  <NotesPanel projectId={projectId} stage={stage} notes={record.notes} anchorOptions={anchorOptions} readOnly={closed} docLabels={Object.fromEntries(bundle.documents.map((d) => [d.id, d.kind.toUpperCase()]))} />
                ) : (
                  <ActivityList items={activity} />
                )}
              </div>
            </div>
          ) : (
            <RailStrip tabs={railTabs} onOpen={openRail} />
          )}
        </aside>
      </div>

      {gate?.hide ? null : (
        <GateFooter
          projectId={projectId}
          stage={stage}
          view={view}
          approveLabel={gate?.approveLabel ?? defaultApproveLabel(stage)}
          decisions={record.decisions}
          done={done}
          nextAction={nextAction}
          canRequestChanges={canRequestChanges}
          lastEventAt={activity[0]?.at}
        />
      )}
    </div>
  );
}
