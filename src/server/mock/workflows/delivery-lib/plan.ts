import "server-only";
/**
 * The dev-plan document format: the markdown written to input.out (the review subject), the
 * "plan report" attachment, and a reader that turns an edited plan file back into tasks so a
 * direct edit of the file carries into the next round or the approved plan.
 */
import type { DevPlanInput, PlannedTask, PlanReport, PlanReportExtras } from "@/lib/weft/workflows";
import { bullets, cell, compareTaskIds, uniq } from "./util";

export type PlanEpic = DevPlanInput["epics"][number];

/** How a content pack names the epic a task belongs to; resolved against input.epics. */
export interface EpicHint {
  title: string;
  /** BR/FR refs that identify the epic when titles differ. */
  refs?: string[];
}

function norm(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Epic ids are assigned by the delivery store, so packs match by title first, then by BR/FR
 * overlap, then fall back to the first epic ("" when the project has none).
 */
export function resolveEpicId(hint: EpicHint | undefined, epics: readonly PlanEpic[], traces: readonly string[]): string {
  if (epics.length === 0) return "";
  if (hint) {
    const exact = epics.find((e) => e.title.trim().toLowerCase() === hint.title.trim().toLowerCase());
    if (exact) return exact.id;
    const hw = new Set(norm(hint.title));
    let best: { id: string; score: number } | undefined;
    for (const e of epics) {
      const ew = norm(e.title);
      const overlap = ew.filter((w) => hw.has(w)).length / Math.max(1, Math.min(ew.length, hw.size));
      if (overlap >= 0.5 && (!best || overlap > best.score)) best = { id: e.id, score: overlap };
    }
    if (best) return best.id;
  }
  const refs = new Set([...(hint?.refs ?? []), ...traces]);
  let best: { id: string; score: number } | undefined;
  for (const e of epics) {
    const score = [...e.brdRequirementRefs, ...e.aadRefs].filter((r) => refs.has(r)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: e.id, score };
  }
  return best?.id ?? epics[0].id;
}

export function waveCount(tasks: readonly PlannedTask[]): number {
  return new Set(tasks.map((t) => t.wave)).size;
}

export function sortTasks(tasks: readonly PlannedTask[]): PlannedTask[] {
  return [...tasks].sort((a, b) => a.wave - b.wave || compareTaskIds(a.id, b.id));
}

/** The exact plan:review question from workflows.ts. */
export function planQuestion(round: number, tasks: readonly PlannedTask[], report: PlanReport): string {
  return `Round ${round}: review the implementation plan (${tasks.length} tasks in ${waveCount(tasks)} waves, ${report.openQuestions.length} open questions). Edit it directly if you like, then approve it or ask for a revision.`;
}

export function renderPlanReport(report: PlanReport & PlanReportExtras, changes: readonly string[]): string {
  return [
    "## Assumptions",
    "",
    bullets(report.assumptions),
    "",
    "## Open questions",
    "",
    bullets(report.openQuestions),
    "",
    "## Requirements not covered by a task",
    "",
    bullets(report.uncovered),
    "",
    ...(report.uncoveredSystems?.length ? ["## Uncovered systems", "", bullets(report.uncoveredSystems), ""] : []),
    ...(report.notesNotApplied?.length ? ["## Notes not applied", "", bullets(report.notesNotApplied), ""] : []),
    "## Risks",
    "",
    bullets(report.risks),
    "",
    "## Changes in this round",
    "",
    bullets(changes),
    "",
  ].join("\n");
}

export interface PlanDocArgs {
  title: string;
  round: number;
  input: DevPlanInput;
  tasks: readonly PlannedTask[];
  report: PlanReport & PlanReportExtras;
  changes: readonly string[];
  summary: string;
}

function epicLabel(epics: readonly PlanEpic[], id: string): string {
  const e = epics.find((x) => x.id === id);
  if (!e) return id || "none";
  return e.key ? `${e.key} ${e.title}` : e.title;
}

export function renderPlanMarkdown(a: PlanDocArgs): string {
  const tasks = sortTasks(a.tasks);
  const waves = uniq(tasks.map((t) => t.wave)).sort((x, y) => x - y);
  const sources = [a.input.brd, a.input.aad, "memory/memory.md"].filter(Boolean).map((p) => `\`${p}\``);
  const teams = uniq(tasks.map((t) => t.team)).join(", ");
  const out: string[] = [
    `# Implementation Plan - ${a.title}`,
    "",
    `Status: proposal for developer review (round ${a.round}). Nothing starts until the plan is approved.`,
    "",
    `Sources: ${sources.join(", ")}${a.input.notes.length ? `, ${a.input.notes.length} developer notes` : ""}. ${tasks.length} tasks in ${waves.length} waves; team ${teams || "not set"}.`,
    "",
    "## Summary",
    "",
    a.summary,
    "",
  ];
  for (const w of waves) {
    out.push(`## Wave ${w}`, "");
    for (const t of tasks.filter((x) => x.wave === w)) {
      out.push(`### ${t.id} ${t.title}`, "");
      out.push(`- Repo: \`${t.repo}\` · Size: ${t.size} · Type: ${t.type} · Priority: ${t.priority}`);
      out.push(`- Epic: ${epicLabel(a.input.epics, t.epicId)}`);
      out.push(`- Depends on: ${t.dependencies.length ? t.dependencies.join(", ") : "none"}`);
      out.push(`- Traces: ${t.traces.length ? t.traces.join(", ") : "none"}`);
      if (t.blockedBy) out.push(`- Blocked by: ${t.blockedBy}`);
      if (t.relatedFiles.length) out.push(`- Files: ${t.relatedFiles.map((f) => `\`${f}\``).join(", ")}`);
      out.push("");
      if (t.description) out.push(t.description, "");
      out.push("Acceptance criteria:", "");
      for (const ac of t.acceptanceCriteria) out.push(`- ${ac.id}: ${ac.text}`);
      if (t.acceptanceCriteria.length === 0) out.push("- none yet");
      out.push("");
    }
  }
  const refs = uniq(tasks.flatMap((t) => t.traces)).sort((x, y) => {
    const kx = x.startsWith("BR") ? 0 : 1;
    const ky = y.startsWith("BR") ? 0 : 1;
    return kx - ky || compareTaskIds(x, y);
  });
  out.push("## Requirements coverage", "", "| Requirement | Tasks |", "| --- | --- |");
  for (const r of refs) {
    out.push(`| ${r} | ${tasks.filter((t) => t.traces.includes(r)).map((t) => t.id).join(", ")} |`);
  }
  for (const u of a.report.uncovered) out.push(`| ${cell(u)} | not covered |`);
  if (a.report.uncoveredSystems?.length) out.push("", "## Uncovered systems", "", bullets(a.report.uncoveredSystems));
  if (a.report.notesNotApplied?.length) out.push("", "## Notes not applied", "", bullets(a.report.notesNotApplied));
  out.push("", "## Changes in this round", "", bullets(a.changes), "");
  return out.join("\n");
}

const SIZES = new Set(["XS", "S", "M", "L"]);
const TYPES = new Set(["story", "task", "bug", "spike"]);
const PRIORITIES = new Set(["low", "medium", "high", "critical"]);

/**
 * Reads an edited plan file back into tasks. Tasks are matched by id; fields the file does not
 * carry (epic id, related files, tags) come from `fallback`. Returns undefined when the file has
 * no task headings, so a free-form edit never wipes the plan.
 */
export function parsePlanMarkdown(markdown: string, fallback: readonly PlannedTask[]): PlannedTask[] | undefined {
  const byId = new Map(fallback.map((t) => [t.id, t]));
  const tasks: PlannedTask[] = [];
  let wave = 1;
  let cur: PlannedTask | undefined;
  let desc: string[] = [];
  let inAcs = false;
  const flush = () => {
    if (!cur) return;
    const text = desc.join("\n").trim();
    if (text) cur.description = text;
    tasks.push(cur);
    cur = undefined;
    desc = [];
    inAcs = false;
  };
  for (const line of markdown.split("\n")) {
    const waveM = /^##\s+Wave\s+(\d+)/i.exec(line);
    if (waveM) {
      flush();
      wave = Number(waveM[1]);
      continue;
    }
    if (/^##\s/.test(line)) {
      flush();
      continue;
    }
    const head = /^###\s+(T-\d+)\s+(.+)$/.exec(line);
    if (head) {
      flush();
      const prev = byId.get(head[1]);
      cur = prev
        ? { ...prev, title: head[2].trim(), wave, acceptanceCriteria: [], description: "" }
        : {
            id: head[1],
            title: head[2].trim(),
            description: "",
            priority: "medium",
            tags: [],
            dependencies: [],
            relatedFiles: [],
            acceptanceCriteria: [],
            epicId: fallback[0]?.epicId ?? "",
            type: "task",
            repo: /^\[([^\]]+)\]/.exec(head[2])?.[1] ?? fallback[0]?.repo ?? "customer-service-v2",
            size: "M",
            team: fallback[0]?.team ?? "Customer Guardians",
            wave,
            traces: [],
          };
      delete cur.blockedBy;
      continue;
    }
    if (!cur) continue;
    const meta = /^-\s+Repo:\s*`?([^`·]+?)`?\s*·\s*Size:\s*(\w+)\s*·\s*Type:\s*(\w+)\s*·\s*Priority:\s*(\w+)/.exec(line);
    if (meta) {
      cur.repo = meta[1].trim();
      if (SIZES.has(meta[2])) cur.size = meta[2] as PlannedTask["size"];
      if (TYPES.has(meta[3])) cur.type = meta[3] as PlannedTask["type"];
      if (PRIORITIES.has(meta[4])) cur.priority = meta[4] as PlannedTask["priority"];
      continue;
    }
    const deps = /^-\s+Depends on:\s*(.+)$/.exec(line);
    if (deps) {
      cur.dependencies = deps[1].trim() === "none" ? [] : [...deps[1].matchAll(/T-\d+/g)].map((m) => m[0]);
      continue;
    }
    const traces = /^-\s+Traces:\s*(.+)$/.exec(line);
    if (traces) {
      cur.traces = traces[1].trim() === "none" ? [] : traces[1].split(",").map((s) => s.trim()).filter(Boolean);
      continue;
    }
    const blocked = /^-\s+Blocked by:\s*(.+)$/.exec(line);
    if (blocked) {
      cur.blockedBy = blocked[1].trim();
      continue;
    }
    if (/^-\s+(Epic|Files):/.test(line)) continue;
    if (/^Acceptance criteria:/i.test(line)) {
      inAcs = true;
      continue;
    }
    if (inAcs) {
      const ac = /^-\s+(AC-\d+):\s*(.+)$/.exec(line);
      if (ac) cur.acceptanceCriteria.push({ id: ac[1], text: ac[2].trim() });
      else if (/^-\s+(.+)$/.test(line) && !/none yet/.test(line)) {
        const text = line.replace(/^-\s+/, "").trim();
        cur.acceptanceCriteria.push({ id: `AC-${cur.acceptanceCriteria.length + 1}`, text });
      }
      continue;
    }
    desc.push(line);
  }
  flush();
  if (tasks.length === 0) return undefined;
  const ids = new Set(tasks.map((t) => t.id));
  return tasks.map((t) => ({ ...t, dependencies: t.dependencies.filter((d) => ids.has(d) && d !== t.id) }));
}

/** True when two task lists differ in anything the plan file shows. */
export function tasksDiffer(a: readonly PlannedTask[], b: readonly PlannedTask[]): boolean {
  const key = (ts: readonly PlannedTask[]) =>
    JSON.stringify(
      sortTasks(ts).map((t) => [t.id, t.title, t.repo, t.size, t.type, t.priority, t.wave, t.dependencies, t.traces, t.blockedBy ?? "", t.acceptanceCriteria]),
    );
  return key(a) !== key(b);
}
