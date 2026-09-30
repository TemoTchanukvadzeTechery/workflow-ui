"use client";

/**
 * The frame every stage workspace shares: a compact header (Stage n of 5 · Title with the owner
 * label, status and metric on the same line; sub-step pills with the run chips beside them;
 * reopen), the main column, a right rail with Requests / Notes / Activity (stacked below on
 * narrow screens) and the GateFooter. The rail folds to a thin tab strip while it holds no
 * request or note of its own, so it does not take 360px from the page to say "nothing here".
 * Locked stages show LockedStage and keep any existing content, and its sub-steps, read-only.
 */
import { useQueries } from "@tanstack/react-query";
import { ArrowLeft, History, Inbox, PanelRightClose, StickyNote, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { weft } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import { STAGES, stageDef, type ProjectBundle, type StageId, type StageStatus } from "@/lib/delivery/types";
import { TERMINAL_RUN_STATUSES, type RunStatus } from "@/lib/weft/types";
import { cn } from "@/lib/utils";
import { actorName, StageStatusPill, TimeAgo } from "../hitl/bits";
import { RequestList } from "../hitl/RequestList";
import { GateFooter, type GateNextAction } from "./GateFooter";
import { nextActionLabel } from "./next-action";
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
 * One rule for every stage's pill badges: "x/y" is progress (neutral), a bare count waits on you
 * (amber) while the stage is open. On an approved, locked or done stage nothing waits, so every
 * badge is neutral there.
 */
function StepBadge({ badge, open }: { badge: ReactNode; open: boolean }) {
  const text = typeof badge === "number" || typeof badge === "string" ? String(badge).trim() : null;
  const count = open && text !== null && /^\d+$/.test(text) && Number(text) > 0;
  return (
    <span
      title={count ? `${text} waiting on you` : undefined}
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 font-mono text-[10.5px] tabular-nums",
        count ? "bg-status-attention-bg font-semibold text-status-attention-fg" : "bg-background",
      )}
    >
      {badge}
      {count ? <span className="sr-only"> waiting on you</span> : null}
    </span>
  );
}

function StepPills({ steps, active, onChange, open }: { steps: StageStep[]; active: string; onChange: (id: string) => void; open: boolean }) {
  const navRef = useRef<HTMLElement>(null);
  // On narrow screens the pill row scrolls sideways; keep the active pill in view (horizontally only, so the page never jumps).
  useEffect(() => {
    const nav = navRef.current;
    const el = nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!nav || !el) return;
    const n = nav.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    if (e.left < n.left) nav.scrollLeft += e.left - n.left - 8;
    else if (e.right > n.right) nav.scrollLeft += e.right - n.right + 8;
  }, [active]);
  if (steps.length === 0) return null;
  return (
    // relative: the scroll box contains its absolutely placed sr-only text, which would otherwise widen the page.
    <nav ref={navRef} aria-label="Stage steps" className="relative -mx-1 max-w-full min-w-0 overflow-x-auto px-1 pb-1">
      <ul className="inline-flex items-center gap-1 rounded-full bg-muted p-1">
        {steps.map((s) => {
          const on = s.id === active;
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={s.disabled}
                aria-current={on ? "step" : undefined}
                onClick={() => onChange(s.id)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-(--disabled-opacity)",
                  on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
                {s.badge !== undefined && s.badge !== null ? <StepBadge badge={s.badge} open={open} /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ActivityList({ items }: { items: ProjectBundle["activity"] }) {
  if (items.length === 0) return <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">No activity yet.</p>;
  return (
    <ol className="space-y-0.5">
      {items.map((a) => {
        const body = (
          <>
            <span className="block text-[13px] leading-snug">{a.text}</span>
            <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
              <span>{actorName(a.actor)}</span>
              <TimeAgo at={a.at} />
              {a.runId ? <span className="font-mono">{a.runId}</span> : null}
            </span>
          </>
        );
        return (
          <li key={a.id}>
            {a.href ? (
              <Link href={a.href} className="block rounded-lg px-2 py-1.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                {body}
              </Link>
            ) : (
              <div className="px-2 py-1.5">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The folded rail: one button per tab (icon + count), vertical beside the page, a row below it on narrow screens. */
function RailStrip({ tabs, onOpen }: { tabs: Array<{ id: RailTab; label: string; icon: LucideIcon; count: number; attention?: boolean }>; onOpen: (tab: RailTab) => void }) {
  return (
    <div role="toolbar" aria-label="Side panel" className="flex gap-1 rounded-2xl bg-muted p-1 @4xl/stage:flex-col">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onOpen(t.id)}
          title={`${t.label}${t.count ? ` (${t.count})` : ""}`}
          aria-label={`Open ${t.label}${t.count ? `, ${t.count}` : ""}`}
          className="relative inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-muted-foreground transition-colors duration-150 outline-none hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring @4xl/stage:w-9 @4xl/stage:justify-center @4xl/stage:px-0"
        >
          <t.icon aria-hidden className="size-4 shrink-0" />
          <span className="@4xl/stage:sr-only">{t.label}</span>
          {t.count > 0 ? (
            <span
              aria-hidden
              className={cn(
                "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px] leading-none tabular-nums @4xl/stage:absolute @4xl/stage:-top-0.5 @4xl/stage:-right-0.5",
                t.attention ? "bg-status-attention-bg text-status-attention-fg" : "bg-card text-muted-foreground",
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
          ? { label: linked.text, href: linked.href }
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
    <div className="@container/stage flex min-w-0 flex-col gap-4">
      <header className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 text-[22px] leading-8 font-normal tracking-[-0.015em]">
            <span className="text-muted-foreground">Stage {def.n} of 5 · </span>
            {def.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-muted-foreground" title="Informational only: no roles yet, anyone can act">
              <UserRound aria-hidden className="size-3.5" />
              {def.owner}
            </span>
            <StageStatusPill status={view.status} />
            {view.metric ? <span className="text-xs text-muted-foreground tabular-nums">{view.metric}</span> : null}
          </div>
          {headerActions || view.status === "approved" ? (
            <div className="flex flex-wrap items-center gap-2 @2xl/stage:ml-auto">
              {headerActions}
              {/* Also on done projects: reopening a stage takes the project out of Done. */}
              {view.status === "approved" ? <ReopenDialog projectId={projectId} stage={stage} /> : null}
            </div>
          ) : null}
        </div>
        {/* A locked stage keeps its sub-steps so what was kept stays reachable, read-only. */}
        {(steps.length > 0 && (!locked || hasContent)) || shownRuns.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {!locked || hasContent ? <StepPills steps={steps} active={activeStep} onChange={changeStep} open={!closed} /> : null}
            {shownRuns.length > 0 ? (
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 @4xl/stage:ml-auto">
                {shownRuns.map((r) => (
                  <RunChip key={r.runId} runId={r.runId} workflow={r.workflow} status={r.status} quiet={repeatsStageStatus(view.status, r.status)} />
                ))}
                {recentRuns.length > shownRuns.length ? (
                  <Link href={`/runs?project=${encodeURIComponent(projectId)}`} className="text-xs text-muted-foreground hover:text-foreground">
                    +{recentRuns.length - shownRuns.length} more runs
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {record.stale ? <StaleBanner stale={record.stale} approvedBefore={record.decisions.some((d) => d.decision === "approved")} /> : null}

      <div className={cn("grid min-w-0 gap-4", railOpen ? "@4xl/stage:grid-cols-[minmax(0,1fr)_360px]" : "@4xl/stage:grid-cols-[minmax(0,1fr)_auto]")}>
        <section className="min-w-0 space-y-4" aria-label={`${def.title} workspace`} data-stage-workspace="">
          {locked ? (
            <>
              <LockedStage stage={stage}>
                {prevStage ? (
                  <Button asChild variant="outline" size="sm" className="mt-1 rounded-full">
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

        {/* Sticky rail sized to end above the sticky GateFooter (top bar 4rem + footer ~5rem + gaps), so its bottom is never hidden. */}
        <aside
          className="min-w-0 space-y-3 @4xl/stage:sticky @4xl/stage:top-16 @4xl/stage:max-h-[calc(100vh-11rem)] @4xl/stage:self-start @4xl/stage:overflow-y-auto"
          aria-label={`${def.title} side panel`}
        >
          {railExtra}
          {railOpen ? (
            <Tabs value={railTab} onValueChange={(v) => setRailTab(v as RailTab)} className="gap-3">
              <div className="flex items-center gap-1">
                <TabsList className="min-w-0 flex-1">
                  <TabsTrigger value="requests">
                    Requests
                    {railCount > 0 ? <span className="rounded-full bg-status-attention-bg px-1.5 font-mono text-[10.5px] text-status-attention-fg">{railCount}</span> : null}
                  </TabsTrigger>
                  <TabsTrigger value="notes">
                    Notes
                    {record.notes.length > 0 ? <span className="rounded-full bg-muted px-1.5 font-mono text-[10.5px]">{record.notes.length}</span> : null}
                  </TabsTrigger>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                </TabsList>
                <Button variant="ghost" size="icon-sm" className="shrink-0 rounded-full text-muted-foreground" aria-label="Fold the side panel" title="Fold the side panel" onClick={() => setRailOpen(false)}>
                  <PanelRightClose aria-hidden />
                </Button>
              </div>
              <TabsContent value="requests">
                <RequestList runIds={liveRunIds} projectId={projectId} hideRunIds={hideRequestsFor} focus={focusRequest} compact emptyText={hideRequestsFor?.length ? "Nothing else is waiting; open requests are shown in the page." : "Nothing in this stage is waiting on a person."} />
              </TabsContent>
              <TabsContent value="notes">
                <NotesPanel projectId={projectId} stage={stage} notes={record.notes} anchorOptions={anchorOptions} readOnly={closed} docLabels={Object.fromEntries(bundle.documents.map((d) => [d.id, d.kind.toUpperCase()]))} />
              </TabsContent>
              <TabsContent value="activity">
                <ActivityList items={activity} />
              </TabsContent>
            </Tabs>
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
