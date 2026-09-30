"use client";

/**
 * The editable plan (brief C.3, D.3 pattern 8): proposed tasks grouped into wave lanes. Each row
 * shows id + [scope] title, repo, size, dependencies, traces and an expandable AC list; rows can
 * be edited inline (title, repo, size, wave, epic, description, dependencies, traces, ACs), added,
 * deleted (with undo), reordered and moved between waves with the menu or, with a mouse, by
 * dragging (HTML5 drag and drop does not work on touch, so the grip only shows for fine pointers).
 */
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  GripVertical,
  MoreHorizontal,
  MoveRight,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { StatusPill } from "@/components/common";
import { ChipToggles } from "@/components/hitl";
import { DepChips, RepoChip, ScopedTitle, SizeChip, TraceChips } from "@/components/tasks";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Epic } from "@/lib/delivery/types";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PlannedTask } from "@/lib/weft/workflows";
import { moveTask, newTask, nudgeTask, planIssues, removeTask, renumberAcs, samePlan, updateTask, wavesOf, type PlanIssue } from "./plan-model";

const SIZES: PlannedTask["size"][] = ["XS", "S", "M", "L"];
const ALL = "__all";

export interface PlanEditorProps {
  tasks: PlannedTask[];
  onChange: (tasks: PlannedTask[]) => void;
  proposal: PlannedTask[];
  epics: Epic[];
  /** Repos the AAD / epics know about, offered when editing. */
  repos: string[];
  disabled?: boolean;
}

function epicLabel(epics: Epic[], id: string): string {
  const e = epics.find((x) => x.id === id);
  return e ? `${e.key ?? e.id} ${e.title}` : id || "No epic";
}

export function PlanEditor({ tasks, onChange, proposal, epics, repos, disabled }: PlanEditorProps) {
  const [epicFilter, setEpicFilter] = useState<string>(ALL);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [extraWaves, setExtraWaves] = useState<number[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ wave: number; before: string | null } | null>(null);
  const filterId = useId();
  // Undo toasts act on this editor's list: drop them once it is locked (answer sent) or gone,
  // so a late Undo neither changes a plan that was already sent nor calls an unmounted editor.
  const undoToasts = useRef(new Set<string | number>());
  const alive = useRef(true);
  const undoToast = (text: string, undo: () => void) => {
    const id = toast(text, {
      action: {
        label: "Undo",
        onClick: () => {
          undoToasts.current.delete(id);
          if (alive.current) undo();
        },
      },
      onDismiss: () => undoToasts.current.delete(id),
      onAutoClose: () => undoToasts.current.delete(id),
    });
    undoToasts.current.add(id);
  };
  useEffect(() => {
    alive.current = true;
    const ids = undoToasts.current;
    return () => {
      alive.current = false;
      for (const id of ids) toast.dismiss(id);
      ids.clear();
    };
  }, []);
  useEffect(() => {
    if (!disabled) return;
    for (const id of undoToasts.current) toast.dismiss(id);
    undoToasts.current.clear();
  }, [disabled]);

  const waves = wavesOf(tasks, extraWaves);
  const issues = useMemo(() => planIssues(tasks), [tasks]);
  const edited = !samePlan(tasks, proposal);
  const repoOptions = useMemo(() => [...new Set([...repos, ...tasks.map((t) => t.repo)].filter(Boolean))].sort(), [repos, tasks]);
  const epicIds = new Set(tasks.map((t) => t.epicId));
  const filterEpics = epics.filter((e) => epicIds.has(e.id));
  const visible = (t: PlannedTask) => epicFilter === ALL || t.epicId === epicFilter;
  const acCount = tasks.reduce((n, t) => n + t.acceptanceCriteria.length, 0);
  const repoCount = new Set(tasks.map((t) => t.repo)).size;

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = (wave: number) => {
    const lane = tasks.filter((t) => t.wave === wave);
    const common = <K extends "repo" | "epicId">(k: K) => {
      const counts = new Map<string, number>();
      for (const t of lane.length ? lane : tasks) counts.set(t[k], (counts.get(t[k]) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    };
    const t = newTask(tasks, wave, { repo: common("repo") || repoOptions[0] || "", epicId: epicFilter !== ALL ? epicFilter : common("epicId") || epics[0]?.id || "" });
    onChange(moveTask([...tasks, t], t.id, wave));
    setEditing(t.id);
    setExpanded((s) => new Set(s).add(t.id));
  };

  const remove = (id: string) => {
    const before = tasks;
    onChange(removeTask(tasks, id));
    if (editing === id) setEditing(null);
    undoToast(`Removed ${id} from the plan`, () => onChange(before));
  };

  const addWave = () => setExtraWaves((w) => [...w, (waves.at(-1) ?? 0) + 1]);

  const onDragStart = (e: DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    setDragId(id);
  };
  const onDragEnd = () => {
    setDragId(null);
    setDrop(null);
  };
  const onDropAt = (e: DragEvent, wave: number, before: string | null) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || dragId;
    if (id) onChange(moveTask(tasks, id, wave, before));
    onDragEnd();
  };

  const errorsOf = (id: string) => issues.filter((i) => i.taskId === id);
  const errorCount = issues.filter((i) => i.level === "error").length;
  const warningCount = issues.filter((i) => i.level === "warning").length;

  return (
    <div className="@container flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] text-muted-foreground tabular-nums">
          <span className="font-medium text-foreground">{plural(tasks.length, "task")}</span> in {plural(wavesOf(tasks).length, "wave")} · {plural(repoCount, "repo")} · {plural(acCount, "acceptance criterion", "acceptance criteria")}
        </p>
        {edited ? <StatusPill tone="review" icon={Pencil} size="sm" label="Edited" /> : null}
        {errorCount ? <StatusPill tone="danger" icon={CircleAlert} size="sm" label={plural(errorCount, "problem")} /> : null}
        {warningCount ? <StatusPill tone="attention" icon={TriangleAlert} size="sm" label={plural(warningCount, "warning")} /> : null}
        <span className="flex-1" />
        {filterEpics.length > 1 ? (
          <>
            <label htmlFor={filterId} className="sr-only">
              Filter by epic
            </label>
            <Select value={epicFilter} onValueChange={setEpicFilter}>
              <SelectTrigger id={filterId} size="sm" className="max-w-full min-w-40 rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All epics</SelectItem>
                {filterEpics.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.key ?? e.id} · {e.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : null}
        {edited ? (
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full"
            disabled={disabled}
            onClick={() => {
              const before = tasks;
              onChange(proposal);
              setExtraWaves([]);
              setEditing(null);
              undoToast("Plan reset to the agent's proposal", () => onChange(before));
            }}
          >
            <RotateCcw aria-hidden />
            Reset to proposal
          </Button>
        ) : null}
      </div>

      {waves.map((wave) => {
        const lane = tasks.filter((t) => t.wave === wave);
        const shown = lane.filter(visible);
        const dropHere = drop?.wave === wave;
        return (
          <section
            key={wave}
            aria-label={`Wave ${wave}`}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              if (!dropHere || drop?.before !== null) {
                if (e.target === e.currentTarget) setDrop({ wave, before: null });
              }
            }}
            onDrop={(e) => onDropAt(e, wave, drop?.wave === wave ? drop.before : null)}
            className={cn("rounded-2xl border border-border bg-card transition-colors", dragId && "border-dashed", dropHere && drop?.before === null && "border-primary bg-primary-soft/40")}
          >
            <header
              className="flex items-center gap-2 border-b border-border px-3 py-2"
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setDrop({ wave, before: lane[0]?.id ?? null });
              }}
            >
              <h3 className="text-[13px] font-medium">Wave {wave}</h3>
              <span className="text-xs text-muted-foreground tabular-nums">
                {epicFilter !== ALL ? `${shown.length} of ${lane.length}` : plural(lane.length, "task")}
              </span>
              {wave > 1 ? <span className="hidden text-xs text-muted-foreground @md:inline">· starts after Wave {wave - 1} tasks it depends on</span> : null}
              <span className="flex-1" />
              <Button size="sm" variant="ghost" className="h-7 rounded-full" onClick={() => add(wave)} disabled={disabled}>
                <Plus aria-hidden />
                Add task
              </Button>
            </header>
            <ol className="flex flex-col">
              {shown.length === 0 ? (
                <li
                  className="px-3 py-5 text-center text-xs text-muted-foreground"
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    setDrop({ wave, before: null });
                  }}
                >
                  {lane.length === 0 ? (
                    <>
                      No tasks yet. Add one, or move a task here with its row menu<span className="hidden pointer-fine:inline"> or by dragging it</span>.
                    </>
                  ) : (
                    "No tasks for this epic in this wave."
                  )}
                </li>
              ) : (
                shown.map((t, i) => (
                  <PlanRow
                    key={t.id}
                    task={t}
                    tasks={tasks}
                    epics={epics}
                    waves={waves}
                    repos={repoOptions}
                    issues={errorsOf(t.id)}
                    expanded={expanded.has(t.id)}
                    editing={editing === t.id}
                    disabled={disabled}
                    first={i === 0}
                    last={i === shown.length - 1}
                    dragging={dragId === t.id}
                    dropBefore={dropHere && drop?.before === t.id && dragId !== t.id}
                    onToggle={() => toggle(t.id)}
                    onEdit={(on) => {
                      setEditing(on ? t.id : null);
                      if (on) setExpanded((s) => new Set(s).add(t.id));
                    }}
                    onPatch={(patch) => onChange(updateTask(tasks, t.id, patch))}
                    onMove={(w) => onChange(moveTask(tasks, t.id, w))}
                    onNudge={(dir) => onChange(nudgeTask(tasks, t.id, dir))}
                    onDelete={() => remove(t.id)}
                    onDragStart={(e) => onDragStart(e, t.id)}
                    onDragEnd={onDragEnd}
                    onDragOverRow={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const after = e.clientY > rect.top + rect.height / 2;
                      const idx = lane.findIndex((x) => x.id === t.id);
                      setDrop({ wave, before: after ? (lane[idx + 1]?.id ?? null) : t.id });
                    }}
                    onNewWave={() => {
                      const w = (waves.at(-1) ?? 0) + 1;
                      onChange(moveTask(tasks, t.id, w));
                    }}
                  />
                ))
              )}
            </ol>
          </section>
        );
      })}

      <button
        type="button"
        onClick={addWave}
        disabled={disabled}
        onDragOver={(e) => {
          if (!dragId) return;
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/plain") || dragId;
          if (id) onChange(moveTask(tasks, id, (waves.at(-1) ?? 0) + 1));
          onDragEnd();
        }}
        className="flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground transition-colors outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <Plus aria-hidden className="size-3.5" />
        {dragId ? `Drop here to start Wave ${(waves.at(-1) ?? 0) + 1}` : `Add Wave ${(waves.at(-1) ?? 0) + 1}`}
      </button>
    </div>
  );
}

interface PlanRowProps {
  task: PlannedTask;
  tasks: PlannedTask[];
  epics: Epic[];
  waves: number[];
  repos: string[];
  issues: PlanIssue[];
  expanded: boolean;
  editing: boolean;
  disabled?: boolean;
  first: boolean;
  last: boolean;
  dragging: boolean;
  dropBefore: boolean;
  onToggle: () => void;
  onEdit: (on: boolean) => void;
  onPatch: (patch: Partial<PlannedTask>) => void;
  onMove: (wave: number) => void;
  onNudge: (dir: -1 | 1) => void;
  onDelete: () => void;
  onNewWave: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onDragOverRow: (e: DragEvent<HTMLLIElement>) => void;
}

function PlanRow(props: PlanRowProps) {
  const { task: t, tasks, epics, waves, issues, expanded, editing, disabled, first, last, dragging, dropBefore } = props;
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const acsId = useId();
  const epic = epics.find((e) => e.id === t.epicId);

  return (
    <li
      draggable={!editing && !disabled}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      onDragOver={props.onDragOverRow}
      className={cn("relative border-b border-border last:border-b-0", dragging && "opacity-40", editing && "bg-muted/30")}
      aria-label={`${t.id} ${t.title || "untitled"}`}
    >
      {dropBefore ? <span aria-hidden className="absolute inset-x-2 -top-px h-0.5 rounded-full bg-primary" /> : null}
      <div className="flex items-start gap-1.5 px-2 py-2">
        <span aria-hidden title="Drag to reorder or move to another wave" className={cn("mt-0.5 hidden cursor-grab text-muted-foreground/60 @md:pointer-fine:inline-flex", (editing || disabled) && "invisible")}>
          <GripVertical className="size-4" />
        </span>
        <button
          type="button"
          onClick={props.onToggle}
          aria-expanded={expanded}
          aria-controls={acsId}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${t.id}`}
          className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {expanded ? <ChevronDown aria-hidden className="size-4" /> : <ChevronRight aria-hidden className="size-4" />}
        </button>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start gap-2">
            <span className="mt-px shrink-0 font-mono text-xs text-muted-foreground">{t.id}</span>
            <span className="min-w-0 flex-1 text-[13px] leading-snug font-medium">{t.title ? <ScopedTitle title={t.title} /> : <span className="text-muted-foreground italic">Untitled task</span>}</span>
            <SizeChip size={t.size} />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {t.repo ? <RepoChip repo={t.repo} /> : null}
            <DepChips deps={t.dependencies} />
            <TraceChips traces={t.traces} max={6} />
            <button
              type="button"
              onClick={props.onToggle}
              aria-expanded={expanded}
              aria-controls={acsId}
              className="inline-flex h-5 items-center gap-1 rounded-md px-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {plural(t.acceptanceCriteria.length, "AC")}
            </button>
            {t.blockedBy ? <span className="text-[11px] text-status-attention-fg">Blocked by {t.blockedBy}</span> : null}
          </div>
          {errors.length || warnings.length ? (
            <ul className="space-y-0.5">
              {errors.map((i) => (
                <li key={i.text} className="flex items-center gap-1 text-[11px] text-status-danger-fg">
                  <CircleAlert aria-hidden className="size-3" />
                  {t.id} {i.text}
                </li>
              ))}
              {warnings.map((i) => (
                <li key={i.text} className="flex items-center gap-1 text-[11px] text-status-attention-fg">
                  <TriangleAlert aria-hidden className="size-3" />
                  {t.id} {i.text}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button size="icon-xs" variant="ghost" aria-label={editing ? `Done editing ${t.id}` : `Edit ${t.id}`} onClick={() => props.onEdit(!editing)} disabled={disabled}>
            {editing ? <X aria-hidden /> : <Pencil aria-hidden />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label={`More actions for ${t.id}`} disabled={disabled}>
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem onSelect={() => props.onNudge(-1)} disabled={first}>
                <ArrowUp aria-hidden />
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => props.onNudge(1)} disabled={last}>
                <ArrowDown aria-hidden />
                Move down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">Move to</DropdownMenuLabel>
              {waves
                .filter((w) => w !== t.wave)
                .map((w) => (
                  <DropdownMenuItem key={w} onSelect={() => props.onMove(w)}>
                    <MoveRight aria-hidden />
                    Wave {w}
                  </DropdownMenuItem>
                ))}
              <DropdownMenuItem onSelect={props.onNewWave}>
                <Plus aria-hidden />
                New wave {(waves.at(-1) ?? 0) + 1}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={props.onDelete}>
                <Trash2 aria-hidden />
                Delete task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {expanded ? (
        <div id={acsId} className="px-2 pb-3 @md:pl-[3.25rem]">
          {editing ? (
            <RowEditor task={t} tasks={tasks} epics={epics} waves={waves} repos={props.repos} onPatch={props.onPatch} onDone={() => props.onEdit(false)} />
          ) : (
            <div className="space-y-2 text-[13px]">
              {t.description ? <p className="leading-relaxed text-muted-foreground">{t.description}</p> : null}
              <ul className="space-y-1">
                {t.acceptanceCriteria.map((ac) => (
                  <li key={ac.id} className="flex gap-2">
                    <span className="shrink-0 font-mono text-[11px] leading-5 text-muted-foreground">{ac.id}</span>
                    <span className="leading-5">{ac.text || <span className="text-muted-foreground italic">empty</span>}</span>
                  </li>
                ))}
                {t.acceptanceCriteria.length === 0 ? <li className="text-xs text-muted-foreground">No acceptance criteria.</li> : null}
              </ul>
              <p className="text-xs text-muted-foreground">
                Epic: {epic ? `${epic.key ?? epic.id} · ${epic.title}` : epicLabel(epics, t.epicId)} · {t.type} · {t.priority} priority
                {t.relatedFiles.length ? ` · ${plural(t.relatedFiles.length, "related file")}` : ""}
              </p>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

function RowEditor({
  task: t,
  tasks,
  epics,
  waves,
  repos,
  onPatch,
  onDone,
}: {
  task: PlannedTask;
  tasks: PlannedTask[];
  epics: Epic[];
  waves: number[];
  repos: string[];
  onPatch: (p: Partial<PlannedTask>) => void;
  onDone: () => void;
}) {
  const base = useId();
  const [traces, setTraces] = useState(t.traces.join(", "));
  const listId = `${base}-repos`;
  const setAc = (i: number, text: string) => onPatch({ acceptanceCriteria: t.acceptanceCriteria.map((ac, j) => (j === i ? { ...ac, text } : ac)) });
  const others = tasks.filter((x) => x.id !== t.id);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3">
      <div className="grid gap-3 @lg:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
        <div className="space-y-1.5">
          <label htmlFor={`${base}-title`} className="text-xs font-medium">
            Title
          </label>
          <Input id={`${base}-title`} value={t.title} onChange={(e) => onPatch({ title: e.target.value })} placeholder="[repo] What this task delivers" aria-invalid={!t.title.trim() || undefined} autoFocus />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${base}-repo`} className="text-xs font-medium">
            Repo
          </label>
          <Input id={`${base}-repo`} list={listId} value={t.repo} onChange={(e) => onPatch({ repo: e.target.value })} className="font-mono text-xs" aria-invalid={!t.repo.trim() || undefined} />
          <datalist id={listId}>
            {repos.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 @lg:grid-cols-4">
        <div className="space-y-1.5">
          <span id={`${base}-size`} className="text-xs font-medium">
            Size
          </span>
          <Select value={t.size} onValueChange={(v) => onPatch({ size: v as PlannedTask["size"] })}>
            <SelectTrigger aria-labelledby={`${base}-size`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIZES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <span id={`${base}-wave`} className="text-xs font-medium">
            Wave
          </span>
          <Select value={String(t.wave)} onValueChange={(v) => onPatch({ wave: Number(v) })}>
            <SelectTrigger aria-labelledby={`${base}-wave`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...waves, (waves.at(-1) ?? 0) + 1].map((w) => (
                <SelectItem key={w} value={String(w)}>
                  Wave {w}
                  {waves.includes(w) ? "" : " (new)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 space-y-1.5">
          <span id={`${base}-epic`} className="text-xs font-medium">
            Epic
          </span>
          <Select value={t.epicId || "__none"} onValueChange={(v) => onPatch({ epicId: v === "__none" ? "" : v })}>
            <SelectTrigger aria-labelledby={`${base}-epic`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">No epic</SelectItem>
              {epics.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.key ?? e.id} · {e.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${base}-desc`} className="text-xs font-medium">
          Description
        </label>
        <Textarea id={`${base}-desc`} rows={3} value={t.description} onChange={(e) => onPatch({ description: e.target.value })} />
      </div>

      {others.length > 0 ? (
        <div className="space-y-1.5">
          <span className="text-xs font-medium">Depends on</span>
          <ChipToggles
            ariaLabel={`${t.id} depends on`}
            values={t.dependencies}
            onChange={(deps) => onPatch({ dependencies: others.map((o) => o.id).filter((id) => deps.includes(id)) })}
            options={others.map((o) => ({ value: o.id, label: <span className="font-mono text-xs">{o.id}</span> }))}
          />
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor={`${base}-traces`} className="text-xs font-medium">
          Traces <span className="font-normal text-muted-foreground">comma separated, e.g. BR-3, FR3</span>
        </label>
        <Input
          id={`${base}-traces`}
          value={traces}
          onChange={(e) => {
            setTraces(e.target.value);
            onPatch({ traces: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) });
          }}
          className="font-mono text-xs"
        />
      </div>

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-xs font-medium">Acceptance criteria</legend>
        <ol className="space-y-1.5">
          {t.acceptanceCriteria.map((ac, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-10 shrink-0 font-mono text-[11px] text-muted-foreground">AC-{i + 1}</span>
              <Input value={ac.text} onChange={(e) => setAc(i, e.target.value)} aria-label={`${t.id} AC-${i + 1}`} aria-invalid={!ac.text.trim() || undefined} className="h-8 text-[13px]" />
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove AC-${i + 1}`}
                onClick={() => onPatch({ acceptanceCriteria: renumberAcs(t.acceptanceCriteria.filter((_, j) => j !== i)) })}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 rounded-full"
          onClick={() => onPatch({ acceptanceCriteria: renumberAcs([...t.acceptanceCriteria, { id: "", text: "" }]) })}
        >
          <Plus aria-hidden />
          Add criterion
        </Button>
      </fieldset>

      <div className="flex justify-end">
        <Button size="sm" className="rounded-full" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
