"use client";

/**
 * The Execution board (brief C.3, D.3 pattern 9): wave headers with hatched progress, then either
 * a kanban (Ready · In progress · Verifying · Awaiting review · Changes requested · Done, with a
 * collapsed Blocked / Cancelled lane) or a dense table grouped by wave. Manual start controls
 * appear when the plan's start mode leaves starting to the developer; a ready task that cannot
 * start yet says what it waits for. On phones the lanes stack and empty lanes shrink to chips.
 */
import { ChevronDown, ChevronRight, Columns3, Hourglass, Play, Rows3, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { HatchedBar, StatusPill, toneClasses } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { usePatchTask } from "@/lib/api/queries";
import type { DeliveryTask, DeliveryTaskStatus } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { taskStatusMeta } from "@/lib/weft/labels";
import type { TaskRequestRef } from "./pending";
import { TaskCard } from "./task-card";
import {
  AgentAvatar,
  BlockedLine,
  ChecksStat,
  DiffStat,
  EscalatedBadge,
  QaReworkBadge,
  RepoChip,
  ReworkBadge,
  ScopedTitle,
  Segmented,
  TaskIdLabel,
  isAgentWorking,
  isQueued,
  taskHref,
  waitReason,
} from "./task-bits";
import { useStartTasksWorded } from "./use-start-tasks";

export type StartMode = "all-waves" | "first-wave" | "manual";

interface Column {
  id: string;
  label: string;
  statuses: DeliveryTaskStatus[];
  meta: ReturnType<typeof taskStatusMeta>;
}

const COLUMNS: Column[] = [
  { id: "ready", label: "Ready", statuses: ["ready", "proposed"], meta: taskStatusMeta("ready") },
  { id: "in_progress", label: "In progress", statuses: ["in_progress"], meta: taskStatusMeta("in_progress") },
  { id: "verifying", label: "Verifying", statuses: ["verifying"], meta: taskStatusMeta("verifying") },
  { id: "in_review", label: "Awaiting review", statuses: ["in_review"], meta: taskStatusMeta("in_review") },
  { id: "changes_requested", label: "Changes requested", statuses: ["changes_requested"], meta: taskStatusMeta("changes_requested") },
  { id: "done", label: "Done", statuses: ["done"], meta: taskStatusMeta("done") },
];

const VIEW_KEY = "u3.board.view";

function readView(): "board" | "table" {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "table" ? "table" : "board";
  } catch {
    return "board";
  }
}

export interface TaskBoardProps {
  projectId: string;
  tasks: DeliveryTask[];
  pending: Map<string, TaskRequestRef[]>;
  /** Plan approved and the stage still open: start and unblock controls are live. */
  canManage: boolean;
  startMode?: StartMode;
  model?: string;
  /** createdAt of a run (the bundle's stage runs), for per-attempt timers on the cards. */
  runCreatedAt?: (runId: string) => number | undefined;
}

export function TaskBoard({ projectId, tasks, pending, canManage, startMode = "manual", model, runCreatedAt }: TaskBoardProps) {
  const [view, setView] = useState<"board" | "table">(readView);
  const start = useStartTasksWorded(projectId);
  const [startingKey, setStartingKey] = useState<string | null>(null);

  const changeView = (v: "board" | "table") => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      // storage unavailable: keep the choice for this visit only
    }
  };

  const auto = startMode === "all-waves";
  const canStartTask = (t: DeliveryTask) => canManage && t.status === "ready" && !isQueued(t) && !auto;

  const startTasks = (key: string, targets: DeliveryTask[], body: { wave?: number; taskIds?: string[] }) => {
    setStartingKey(key);
    start.mutate({ body, targets, tasks }, { onSettled: () => setStartingKey(null) });
  };

  const onBoard = tasks.filter((t) => t.status !== "blocked" && t.status !== "cancelled");
  const offBoard = tasks.filter((t) => t.status === "blocked" || t.status === "cancelled");

  return (
    <div className="@container flex min-w-0 flex-col gap-3">
      <WaveStrip
        tasks={tasks}
        canManage={canManage}
        auto={auto}
        startingKey={startingKey}
        onStartWave={(wave, targets) => startTasks(`wave:${wave}`, targets, { wave })}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Board layout"
          value={view}
          onChange={changeView}
          options={[
            { value: "board", label: "Board", icon: Columns3 },
            { value: "table", label: "Table", icon: Rows3 },
          ]}
        />
        <span className="flex-1" />
        <StartModeNote mode={startMode} canManage={canManage} />
      </div>

      {view === "board" ? (
        <Kanban
          projectId={projectId}
          tasks={onBoard}
          all={tasks}
          pending={pending}
          model={model}
          canStartTask={canStartTask}
          startingKey={startingKey}
          onStartTask={(t) => startTasks(`task:${t.id}`, [t], { taskIds: [t.id] })}
          runCreatedAt={runCreatedAt}
        />
      ) : (
        <TaskTable
          projectId={projectId}
          tasks={tasks}
          pending={pending}
          model={model}
          canStartTask={canStartTask}
          startingKey={startingKey}
          onStartTask={(t) => startTasks(`task:${t.id}`, [t], { taskIds: [t.id] })}
        />
      )}

      {view === "board" && offBoard.length > 0 ? <OffBoardLane projectId={projectId} tasks={offBoard} all={tasks} canManage={canManage} /> : null}
    </div>
  );
}

function StartModeNote({ mode, canManage }: { mode: StartMode; canManage: boolean }) {
  if (!canManage) return null;
  const text =
    mode === "all-waves"
      ? "Start mode: all waves automatically. Agents pick up each wave as the one before it is approved."
      : mode === "first-wave"
        ? "Start mode: first wave only. Start later waves yourself."
        : "Start mode: manual. Start each wave or task yourself.";
  return <p className="text-[13px] leading-5 text-muted-foreground">{text}</p>;
}

// ---------------------------------------------------------------------------------------------
// Wave headers
// ---------------------------------------------------------------------------------------------

function waveGroups(tasks: readonly DeliveryTask[]): Array<[number, DeliveryTask[]]> {
  const by = new Map<number, DeliveryTask[]>();
  for (const t of tasks) by.set(t.wave, [...(by.get(t.wave) ?? []), t]);
  return [...by.entries()].sort((a, b) => a[0] - b[0]);
}

function waveState(list: DeliveryTask[]) {
  const counted = list.filter((t) => t.status !== "cancelled");
  const done = counted.filter((t) => t.status === "done").length;
  const inFlight = counted.filter((t) => ["in_progress", "verifying", "in_review", "changes_requested"].includes(t.status)).length;
  const ready = list.filter((t) => t.status === "ready");
  const startable = ready.filter((t) => !isQueued(t));
  const blocked = list.filter((t) => t.status === "blocked").length;
  return { total: counted.length, done, inFlight, ready, startable, blocked };
}

function WaveStrip({
  tasks,
  canManage,
  auto,
  startingKey,
  onStartWave,
}: {
  tasks: DeliveryTask[];
  canManage: boolean;
  auto: boolean;
  startingKey: string | null;
  onStartWave: (wave: number, targets: DeliveryTask[]) => void;
}) {
  const waves = waveGroups(tasks);
  return (
    <ol aria-label="Waves" className="grid gap-3 @lg:grid-cols-2 @3xl:grid-cols-3">
      {waves.map(([wave, list]) => {
        const s = waveState(list);
        const complete = s.total > 0 && s.done === s.total;
        const pill = complete
          ? { tone: "success" as const, label: "Done" }
          : s.inFlight > 0
            ? { tone: "running" as const, label: "In progress" }
            : s.done > 0
              ? { tone: "running" as const, label: "Partly done" }
              : s.blocked === s.total && s.total > 0
                ? { tone: "attention" as const, label: "Blocked" }
                : { tone: "neutral" as const, label: "Not started" };
        const key = `wave:${wave}`;
        return (
          <li key={wave} className="card-surface flex min-w-0 flex-col gap-3 rounded-[20px] p-4">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="text-[15px] leading-6 text-muted-foreground">Wave {wave}</h3>
              <StatusPill tone={pill.tone} label={pill.label} size="sm" icon={complete ? taskStatusMeta("done").icon : null} pulse={pill.label === "In progress"} />
              <span className="flex-1" />
              <span className="text-[15px] leading-6 text-heading tabular-nums">
                {s.done}/{s.total}
                <span className="sr-only"> done</span>
              </span>
            </div>
            <HatchedBar done={s.done} partial={s.inFlight} total={s.total} size="lg" tone={complete ? "success" : "running"} label={`Wave ${wave}: ${s.done} of ${s.total} done, ${s.inFlight} in progress`} />
            <div className="flex min-h-8 flex-wrap items-center gap-1.5">
              {list.map((t) => {
                const meta = taskStatusMeta(t.status);
                return (
                  <span key={t.id} title={`${t.id}: ${meta.label}`} className="inline-flex h-6 items-center gap-1 rounded-full bg-well px-2 font-mono text-[11px] text-muted-foreground">
                    <meta.icon aria-hidden className={cn("size-3", toneClasses(meta.tone).text)} />
                    {t.id}
                    <span className="sr-only">{meta.label}</span>
                  </span>
                );
              })}
              <span className="flex-1" />
              {canManage && !auto && s.startable.length > 0 ? (
                <Button size="sm" variant="secondary" disabled={startingKey === key} onClick={() => onStartWave(wave, s.startable)}>
                  {startingKey === key ? <Spinner aria-hidden /> : <Play aria-hidden />}
                  Start wave {wave}
                </Button>
              ) : canManage && s.ready.length > 0 && s.startable.length === 0 ? (
                <QueuedNote queued={s.ready} all={tasks} />
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** "Queued: T-9 starts after T-7 is approved" for a wave whose ready tasks all wait. */
function QueuedNote({ queued, all }: { queued: DeliveryTask[]; all: DeliveryTask[] }) {
  const first = queued[0];
  const why = first ? waitReason(first, all) : null;
  const text = first && why ? `Queued: ${first.id} ${why}${queued.length > 1 ? ` (+${queued.length - 1} more)` : ""}` : "Queued";
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground" title={text}>
      <Hourglass aria-hidden className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{text}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Kanban
// ---------------------------------------------------------------------------------------------

interface ViewProps {
  projectId: string;
  pending: Map<string, TaskRequestRef[]>;
  model?: string;
  canStartTask: (t: DeliveryTask) => boolean;
  startingKey: string | null;
  onStartTask: (t: DeliveryTask) => void;
  runCreatedAt?: (runId: string) => number | undefined;
}

function Kanban({ projectId, tasks, all, pending, model, canStartTask, startingKey, onStartTask, runCreatedAt }: ViewProps & { tasks: DeliveryTask[]; all: DeliveryTask[] }) {
  const byColumn = useMemo(() => COLUMNS.map((c) => ({ col: c, list: tasks.filter((t) => c.statuses.includes(t.status)).sort((a, b) => a.wave - b.wave || a.id.localeCompare(b.id, undefined, { numeric: true })) })), [tasks]);
  const scroller = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(scroller, byColumn);
  return (
    <div className="relative -mx-1 min-w-0">
      {edges.left ? <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-[2] w-6 bg-gradient-to-r from-background to-transparent" /> : null}
      {edges.right ? (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-[2] flex w-10 items-start justify-end bg-gradient-to-l from-background to-transparent pt-2 pr-1">
          <ChevronRight className="size-4 text-muted-foreground" />
        </span>
      ) : null}
      {/*
        Narrow (phones): lanes stack at full width and empty lanes shrink to count chips in one
        row above them (flex order), so no width goes to empty columns. From @xl the lanes sit side
        by side, empty ones as thin vertical strips; items-start sizes each lane to its cards.
      */}
      <div ref={scroller} role="list" aria-label="Task board" className="flex flex-wrap gap-2 px-1 pb-2 @xl:snap-x @xl:snap-mandatory @xl:flex-nowrap @xl:items-start @xl:overflow-x-auto @3xl:snap-none">
        {byColumn.map(({ col, list }) =>
          list.length === 0 ? (
            <div
              key={col.id}
              role="listitem"
              aria-label={`${col.label}: no tasks`}
              className="order-first inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-well px-3 @xl:order-none @xl:h-auto @xl:w-10 @xl:snap-start @xl:flex-col @xl:gap-2 @xl:rounded-[20px] @xl:px-0 @xl:py-3.5"
            >
              <col.meta.icon aria-hidden className={cn("size-3.5", toneClasses(col.meta.tone).text)} />
              <span className="order-last text-xs text-muted-foreground tabular-nums @xl:order-none">0</span>
              <span className="text-xs font-medium whitespace-nowrap text-muted-foreground @xl:[writing-mode:vertical-rl]">{col.label}</span>
            </div>
          ) : (
            <section
              key={col.id}
              role="listitem"
              aria-label={`${col.label}: ${list.length} ${list.length === 1 ? "task" : "tasks"}`}
              className="flex w-full min-w-0 shrink-0 flex-col gap-2 rounded-[20px] bg-well p-2 @xl:w-auto @xl:max-w-[340px] @xl:min-w-[210px] @xl:flex-[1_1_220px] @xl:snap-start"
            >
              <header className="flex h-8 items-center gap-2 px-2">
                <col.meta.icon aria-hidden className={cn("size-4", toneClasses(col.meta.tone).text)} strokeWidth={2} />
                <h3 className="text-[13px] font-medium text-heading">{col.label}</h3>
                <span className="text-[13px] text-muted-foreground tabular-nums">{list.length}</span>
              </header>
              <div className="flex flex-col gap-2">
                {list.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    projectId={projectId}
                    tasks={all}
                    pending={pending.get(t.id)}
                    model={model}
                    canStart={canStartTask(t)}
                    starting={startingKey === `task:${t.id}`}
                    onStart={() => onStartTask(t)}
                    runCreatedAt={runCreatedAt}
                  />
                ))}
              </div>
            </section>
          ),
        )}
      </div>
    </div>
  );
}

/** Whether a horizontal scroller has more content to the left / right (for edge fades). */
function useScrollEdges(ref: RefObject<HTMLDivElement | null>, version: unknown): { left: boolean; right: boolean } {
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
    };
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    for (const child of Array.from(el.children)) ro?.observe(child);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro?.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [ref, version]);
  return edges;
}

function OffBoardLane({ projectId, tasks, all, canManage }: { projectId: string; tasks: DeliveryTask[]; all: DeliveryTask[]; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const patch = usePatchTask(projectId);
  const blocked = tasks.filter((t) => t.status === "blocked");
  const cancelled = tasks.filter((t) => t.status === "cancelled");
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-[20px] bg-well">
      <CollapsibleTrigger className="flex min-h-11 w-full items-center gap-2 rounded-[20px] px-4 py-2 text-left text-sm outline-none hover:bg-well-hover focus-visible:ring-3 focus-visible:ring-ring/50">
        {open ? <ChevronDown aria-hidden className="size-4 text-muted-foreground" /> : <ChevronRight aria-hidden className="size-4 text-muted-foreground" />}
        <span className="font-medium text-heading">Blocked</span>
        <span className="text-[13px] text-muted-foreground tabular-nums">{blocked.length}</span>
        <span aria-hidden className="text-muted-foreground">·</span>
        <span className="font-medium text-heading">Cancelled</span>
        <span className="text-[13px] text-muted-foreground tabular-nums">{cancelled.length}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{blocked[0]?.blockedBy ? `${blocked[0].id}: ${blocked[0].blockedBy}` : ""}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-2 p-2 pt-0 @lg:grid-cols-2 @3xl:grid-cols-3">
          {tasks.map((t) => (
            <div key={t.id} className="flex flex-col gap-2">
              <TaskCard task={t} projectId={projectId} tasks={all} />
              {canManage ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  disabled={patch.isPending}
                  onClick={() => patch.mutate({ taskId: t.id, body: { status: "ready" } })}
                >
                  <Undo2 aria-hidden />
                  {t.status === "blocked" ? "Mark ready (unblock)" : "Restore to Ready"}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------------------------

/*
 * Columns fit the board's container: from @xl (~576px) the table takes the card's width and the
 * Task column (with the repo chip) gets whatever the three fixed columns leave; the agent at work
 * sits under the status. On phones the table keeps a minimum width and scrolls, with the Action
 * column pinned to the right edge so Review / Start never scroll out of reach. The layout is
 * fixed, so a long agent step truncates in its column instead of widening the table.
 */
const ACTION_CELL = "sticky right-0 z-[1] bg-card px-4 py-2.5 text-right shadow-[-1px_0_0_var(--color-rule)] @xl:static @xl:shadow-none";

function TaskTable({ projectId, tasks, pending, model, canStartTask, startingKey, onStartTask }: ViewProps & { tasks: DeliveryTask[] }) {
  const waves = waveGroups(tasks);
  return (
    <div className="card-surface relative min-w-0 overflow-x-auto rounded-[20px]">
      <table className="w-full min-w-[36rem] table-fixed border-collapse text-sm @xl:min-w-0">
        <caption className="sr-only">Tasks by wave</caption>
        <thead className="text-left text-[13px] text-muted-foreground">
          <tr className="h-11 border-b border-rule">
            <th scope="col" className="px-4 py-2 font-normal">
              Task
            </th>
            <th scope="col" className="w-52 px-4 py-2 font-normal">
              Status · agent
            </th>
            <th scope="col" className="w-32 px-4 py-2 font-normal">
              Checks · diff
            </th>
            <th scope="col" className={cn(ACTION_CELL, "w-32 font-normal")}>
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        {waves.map(([wave, list]) => {
          const s = waveState(list);
          return (
            <tbody key={wave}>
              <tr className="border-t border-rule bg-foreground/[0.02]">
                <th scope="rowgroup" colSpan={4} className="px-4 py-2 text-left">
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-medium whitespace-nowrap text-heading">
                      Wave {wave} <span className="font-normal text-muted-foreground tabular-nums">· {s.done}/{s.total} done</span>
                    </span>
                    <HatchedBar done={s.done} partial={s.inFlight} total={s.total} size="md" className="max-w-48" tone={s.done === s.total && s.total > 0 ? "success" : "running"} />
                  </div>
                </th>
              </tr>
              {list.map((t) => {
                const review = pending.get(t.id)?.[0];
                const working = isAgentWorking(t);
                const wait = waitReason(t, tasks);
                return (
                  <tr key={t.id} className="h-12 border-t border-rule align-middle transition-colors hover:bg-foreground/[0.025]">
                    <td className="px-4 py-2.5">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <TaskIdLabel task={t} />
                        <Link href={taskHref(projectId, t.id)} className="font-medium text-heading hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                          <ScopedTitle title={t.title} hideScope={t.repo} />
                        </Link>
                        <div className="flex flex-wrap items-center gap-1">
                          <RepoChip repo={t.repo} />
                          {t.reworkFrom === "qa" ? <QaReworkBadge /> : null}
                          <ReworkBadge count={t.reworkCount} />
                          {t.escalated ? <EscalatedBadge /> : null}
                        </div>
                        {t.status === "blocked" ? <BlockedLine reason={t.blockedBy} /> : null}
                        {wait ? (
                          <p className="flex items-start gap-1 text-xs text-muted-foreground">
                            <Hourglass aria-hidden className="mt-px size-3 shrink-0" />
                            <span className="min-w-0">
                              {isQueued(t) ? "Queued · " : ""}
                              {wait.charAt(0).toUpperCase() + wait.slice(1)}
                            </span>
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex min-w-0 flex-col items-start gap-1.5">
                        <StatusPill status={{ kind: "task", value: t.status }} size="sm" />
                        {working ? <AgentAvatar model={model} live className="max-w-full" /> : null}
                        {t.latestStep && !isQueued(t) ? (
                          <span className={cn("line-clamp-2 max-w-full font-mono text-xs break-words", working ? "text-status-running-fg" : "text-muted-foreground")} title={t.latestStep}>
                            {t.latestStep}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col gap-1">
                        <ChecksStat checks={t.checks} />
                        <DiffStat stats={t.diffStats} />
                        {t.checks.length === 0 && !t.diffStats ? <span className="text-muted-foreground">-</span> : null}
                      </div>
                    </td>
                    <td className={ACTION_CELL}>
                      {review ? (
                        <Button asChild size="sm">
                          <Link href={taskHref(projectId, t.id, `${review.runId}:${review.requestId}`)}>{review.kind === "qa-review" ? "QA review" : "Review"}</Link>
                        </Button>
                      ) : canStartTask(t) ? (
                        <Button size="sm" variant="secondary" onClick={() => onStartTask(t)} disabled={startingKey === `task:${t.id}`}>
                          {startingKey === `task:${t.id}` ? <Spinner aria-hidden /> : <Play aria-hidden />}
                          Start
                        </Button>
                      ) : isQueued(t) ? (
                        <span className="text-xs text-muted-foreground" title={wait ? `Queued: ${wait}` : "Queued"}>
                          Queued
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
