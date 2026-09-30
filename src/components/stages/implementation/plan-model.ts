/**
 * Pure edits on a draft plan (PlannedTask[]). Array order is the order inside each wave; the
 * editor groups by wave for display. Every function returns a new array.
 */
import type { PlannedTask } from "@/lib/weft/workflows";

export function wavesOf(tasks: readonly PlannedTask[], extra: readonly number[] = []): number[] {
  return [...new Set([...tasks.map((t) => t.wave), ...extra])].sort((a, b) => a - b);
}

function idNumber(id: string): number {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

export function nextTaskId(tasks: readonly PlannedTask[]): string {
  const prefix = /^([A-Za-z]+-)/.exec(tasks[0]?.id ?? "")?.[1] ?? "T-";
  return `${prefix}${Math.max(0, ...tasks.map((t) => idNumber(t.id))) + 1}`;
}

export function updateTask(tasks: readonly PlannedTask[], id: string, patch: Partial<PlannedTask>): PlannedTask[] {
  return tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

/** Remove a task and every dependency on it. */
export function removeTask(tasks: readonly PlannedTask[], id: string): PlannedTask[] {
  return tasks.filter((t) => t.id !== id).map((t) => (t.dependencies.includes(id) ? { ...t, dependencies: t.dependencies.filter((d) => d !== id) } : t));
}

/** Move a task to `wave`, before `beforeId` (a task of that wave) or at the end of the wave. */
export function moveTask(tasks: readonly PlannedTask[], id: string, wave: number, beforeId?: string | null): PlannedTask[] {
  const task = tasks.find((t) => t.id === id);
  if (!task || beforeId === id) return [...tasks];
  const rest = tasks.filter((t) => t.id !== id);
  const moved = { ...task, wave };
  let at = beforeId ? rest.findIndex((t) => t.id === beforeId) : -1;
  if (at < 0) {
    // After the last task of the wave, or after every earlier wave when the wave is empty.
    let last = -1;
    rest.forEach((t, i) => {
      if (t.wave <= wave) last = i;
    });
    at = last + 1;
  }
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
}

/** Swap with the previous (-1) or next (+1) task of the same wave. */
export function nudgeTask(tasks: readonly PlannedTask[], id: string, dir: -1 | 1): PlannedTask[] {
  const task = tasks.find((t) => t.id === id);
  if (!task) return [...tasks];
  const same = tasks.filter((t) => t.wave === task.wave);
  const i = same.findIndex((t) => t.id === id);
  const other = same[i + dir];
  if (!other) return [...tasks];
  const a = tasks.indexOf(task);
  const b = tasks.indexOf(other);
  const out = [...tasks];
  out[a] = other;
  out[b] = task;
  return out;
}

/** Renumber acceptance criteria AC-1..n in order. */
export function renumberAcs(acs: ReadonlyArray<{ id: string; text: string }>): Array<{ id: string; text: string }> {
  return acs.map((ac, i) => ({ ...ac, id: `AC-${i + 1}` }));
}

export function newTask(tasks: readonly PlannedTask[], wave: number, defaults: { repo: string; epicId: string; team?: string }): PlannedTask {
  return {
    id: nextTaskId(tasks),
    title: "",
    description: "",
    priority: "medium",
    tags: [],
    dependencies: [],
    relatedFiles: [],
    acceptanceCriteria: [{ id: "AC-1", text: "" }],
    epicId: defaults.epicId,
    type: "task",
    repo: defaults.repo,
    size: "M",
    team: defaults.team ?? "Customer Guardians",
    wave,
    traces: [],
  };
}

export interface PlanIssue {
  taskId: string;
  level: "error" | "warning";
  text: string;
}

/** Errors block the answer; warnings are shown but allowed. */
export function planIssues(tasks: readonly PlannedTask[]): PlanIssue[] {
  const out: PlanIssue[] = [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const t of tasks) {
    if (!t.title.trim()) out.push({ taskId: t.id, level: "error", text: "needs a title" });
    if (!t.repo.trim()) out.push({ taskId: t.id, level: "error", text: "needs a repo" });
    if (t.acceptanceCriteria.some((ac) => !ac.text.trim())) out.push({ taskId: t.id, level: "error", text: "has an empty acceptance criterion" });
    if (t.acceptanceCriteria.length === 0) out.push({ taskId: t.id, level: "warning", text: "has no acceptance criteria" });
    for (const d of t.dependencies) {
      const dep = byId.get(d);
      if (dep && dep.wave > t.wave) out.push({ taskId: t.id, level: "warning", text: `depends on ${d} in a later wave (Wave ${dep.wave})` });
    }
  }
  if (tasks.length === 0) out.push({ taskId: "", level: "error", text: "The plan has no tasks" });
  return out;
}

/** Same tasks, same content, same order. */
export function samePlan(a: readonly PlannedTask[], b: readonly PlannedTask[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A structured list the server accepts: trimmed text, no empty fields, known dependencies only. */
export function cleanPlan(tasks: readonly PlannedTask[]): PlannedTask[] {
  const ids = new Set(tasks.map((t) => t.id));
  return tasks.map((t) => {
    const out: PlannedTask = {
      ...t,
      title: t.title.trim(),
      description: t.description.trim(),
      repo: t.repo.trim(),
      dependencies: t.dependencies.filter((d) => ids.has(d) && d !== t.id),
      traces: t.traces.map((x) => x.trim()).filter(Boolean),
      acceptanceCriteria: renumberAcs(t.acceptanceCriteria.map((ac) => ({ ...ac, text: ac.text.trim() })).filter((ac) => ac.text)),
    };
    if (!out.blockedBy) delete out.blockedBy;
    return out;
  });
}
