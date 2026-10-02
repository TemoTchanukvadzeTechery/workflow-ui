/**
 * Turning a captured phrase into a parameter value: "checkout" → the project id `checkout-v2`,
 * "stage 2" → "architecture", "T-3" → a task id. Each kind also offers choices for when the
 * value is missing or ambiguous ("Which project?" with one chip per project), a default from
 * the page, and a display label for the confirmation card.
 */
import { STAGES, stageDef, type ProjectBundle, type StageId } from "@/lib/delivery/types";
import { isRequired } from "./define";
import type { Choice, PageId, ParamSpec, ToolContext, ToolInput } from "./types";

export type Resolution = { ok: true; value: unknown } | { ok: false; message: string; options?: Choice[] };

export interface SlotEnv {
  ctx: ToolContext;
  /** Parameters resolved so far (in declaration order), so a task can look in its project. */
  input: ToolInput;
  spec: ParamSpec;
}

/** Lowercase, dashes and punctuation to spaces: "Checkout-v2!" → "checkout v2". */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const unquote = (s: string) => s.trim().replace(/^["'`]+|["'`]+$/g, "").trim();

/** "this project", "it", "the current one": the page's value. */
const DEICTIC = /^(?:this|that|the\s+current|current|it|here|the\s+open|my)(?:\s+(?:one|project|stage|run|note|page|task))?$/i;

/**
 * The best match of `raw` among items by their names: an exact name wins, then a name that
 * contains the phrase (or is contained in it), then most shared words. Several equally good
 * matches are returned as ambiguous.
 */
export function fuzzyFind<T>(raw: string, items: readonly T[], names: (t: T) => Array<string | null | undefined>): { match?: T; ambiguous: T[] } {
  const q = norm(unquote(raw));
  if (!q) return { ambiguous: [] };
  const qWords = new Set(q.split(" "));
  let best: T[] = [];
  let bestScore = 0;
  for (const item of items) {
    let score = 0;
    for (const name of names(item)) {
      if (!name) continue;
      const n = norm(name);
      if (!n) continue;
      let s = 0;
      if (n === q) s = 100;
      else if (n.startsWith(q) || n.includes(` ${q}`)) s = 70 + Math.min(q.length / n.length, 1) * 10;
      else if (q.includes(n) && n.length >= 3) s = 60;
      else {
        const nWords = n.split(" ");
        const shared = nWords.filter((w) => qWords.has(w) && w.length > 1).length;
        if (shared) s = (40 * shared) / Math.max(nWords.length, qWords.size);
      }
      score = Math.max(score, s);
    }
    if (score > bestScore) {
      best = [item];
      bestScore = score;
    } else if (score === bestScore && score > 0) best.push(item);
  }
  if (bestScore < 15) return { ambiguous: [] };
  return best.length === 1 ? { match: best[0], ambiguous: [] } : { ambiguous: best };
}

const STAGE_WORDS: Record<StageId, string[]> = {
  requirements: ["requirements", "requirement", "reqs", "req", "brd", "po-brd", "po brd", "stage 1", "stage one", "first stage", "1"],
  architecture: ["architecture", "arch", "aad", "architect", "architect-aad", "stage 2", "stage two", "second stage", "2"],
  implementation: ["implementation", "implement", "impl", "build", "dev", "development", "plan", "dev-plan", "stage 3", "stage three", "third stage", "3"],
  qa: ["qa", "qa certification", "certification", "testing", "test", "tests", "quality", "stage 4", "stage four", "fourth stage", "4"],
  signoff: ["signoff", "sign-off", "sign off", "po review", "po sign-off", "review", "final review", "stage 5", "stage five", "last stage", "5"],
};

const PAGE_WORDS: Record<PageId, string[]> = {
  home: ["home", "dashboard", "overview", "start page", "main page", "front page"],
  inbox: ["inbox", "notifications", "queue", "my queue", "requests", "waiting"],
  projects: ["projects", "project list", "all projects", "portfolio"],
  "new-project": ["new project", "create project", "project form", "new"],
  runs: ["runs", "run list", "agent runs", "weft runs", "all runs"],
  memory: ["memory", "vault", "knowledge", "memory page", "brain"],
  settings: ["settings", "preferences", "config", "configuration", "options"],
};

export const PAGE_HREF: Record<PageId, string> = {
  home: "/",
  inbox: "/inbox",
  projects: "/projects",
  "new-project": "/projects/new",
  runs: "/runs",
  memory: "/memory",
  settings: "/settings",
};

const DOC_WORDS: Record<"brd" | "aad" | "plan", string[]> = {
  brd: ["brd", "requirements", "requirements doc", "business requirements", "requirements document"],
  aad: ["aad", "architecture", "architecture doc", "design doc", "architecture document"],
  plan: ["plan", "implementation plan", "dev plan", "task plan"],
};

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function wordsLookup<K extends string>(raw: string, table: Record<K, string[]>): K | undefined {
  const q = norm(unquote(raw)).replace(/^(?:the|a|an)\s+/, "").replace(/\s+(?:stage|page|doc|document)$/, "");
  for (const [key, words] of Object.entries(table) as Array<[K, string[]]>) {
    if (words.some((w) => norm(w) === q)) return key;
  }
  return undefined;
}

const choice = (label: string, reply = label): Choice => ({ label, reply });
const MAX_CHOICES = 6;

async function bundleOf(env: SlotEnv): Promise<ProjectBundle | undefined> {
  const id = (env.input.projectId as string | undefined) ?? env.ctx.page.projectId;
  if (!id) return undefined;
  try {
    return await env.ctx.world.project(id);
  } catch {
    return undefined;
  }
}

const noProject: Resolution = { ok: false, message: "I need a project for that first." };

/** Resolve one captured phrase. */
export async function resolveSlot(raw: string, env: SlotEnv): Promise<Resolution> {
  const { ctx, spec } = env;
  const text = unquote(raw);
  if (!text) return { ok: false, message: "That was empty." };
  const deictic = DEICTIC.test(text);

  switch (spec.kind) {
    case "project": {
      if (deictic && ctx.page.projectId) return { ok: true, value: ctx.page.projectId };
      const projects = await ctx.world.projects();
      const { match, ambiguous } = fuzzyFind(text, projects, (p) => [p.name, p.id, p.key]);
      if (match) return { ok: true, value: match.id };
      const pool = ambiguous.length ? ambiguous : projects;
      return { ok: false, message: ambiguous.length ? `Several projects match "${text}".` : `I couldn't find a project called "${text}".`, options: pool.slice(0, MAX_CHOICES).map((p) => choice(p.name)) };
    }
    case "stage": {
      if (deictic && ctx.page.stage) return { ok: true, value: ctx.page.stage };
      const stage = wordsLookup(text, STAGE_WORDS);
      if (stage) return { ok: true, value: stage };
      return { ok: false, message: `"${text}" isn't a stage.`, options: STAGES.map((s) => choice(s.title)) };
    }
    case "doc": {
      const doc = wordsLookup(text, DOC_WORDS);
      if (doc) return { ok: true, value: doc };
      return { ok: false, message: `"${text}" isn't a document I know.`, options: [choice("BRD"), choice("AAD"), choice("Plan")] };
    }
    case "page": {
      const page = wordsLookup(text, PAGE_WORDS);
      if (page) return { ok: true, value: page };
      return { ok: false, message: `"${text}" isn't a page.`, options: ["Home", "Inbox", "Projects", "Runs", "Memory", "Settings"].map((p) => choice(p)) };
    }
    case "run": {
      if (deictic && ctx.page.runId) return { ok: true, value: ctx.page.runId };
      const runs = await ctx.world.runs();
      if (/^(?:the\s+)?(?:latest|last|newest|most\s+recent)(?:\s+run)?$/i.test(text)) {
        const latest = [...runs].sort((a, b) => b.createdAt - a.createdAt)[0];
        return latest ? { ok: true, value: latest.runId } : { ok: false, message: "There are no runs yet." };
      }
      const exact = runs.find((r) => r.runId === text) ?? runs.filter((r) => r.runId.startsWith(text)).at(0);
      if (exact && runs.filter((r) => r.runId.startsWith(text)).length <= 1) return { ok: true, value: exact.runId };
      const byWorkflow = runs.filter((r) => norm(r.workflow) === norm(text.replace(/\s+run$/i, ""))).sort((a, b) => b.createdAt - a.createdAt);
      if (byWorkflow.length) return { ok: true, value: byWorkflow[0].runId };
      const recent = [...runs].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_CHOICES);
      return { ok: false, message: `I couldn't find run "${text}".`, options: recent.map((r) => choice(`${r.workflow} · ${r.runId}`, r.runId)) };
    }
    case "task": {
      const b = await bundleOf(env);
      if (!b) return noProject;
      const t = text.replace(/^task\s+/i, "");
      const exact = b.tasks.find((x) => x.id.toLowerCase() === t.toLowerCase() || x.jiraKey?.toLowerCase() === t.toLowerCase() || `t-${t}` === x.id.toLowerCase());
      if (exact) return { ok: true, value: exact.id };
      const { match, ambiguous } = fuzzyFind(t, b.tasks, (x) => [x.title, x.title.replace(/^\[[^\]]*\]\s*/, "")]);
      if (match) return { ok: true, value: match.id };
      const pool = ambiguous.length ? ambiguous : b.tasks;
      return { ok: false, message: `I couldn't find task "${text}" in ${b.project.name}.`, options: pool.slice(0, MAX_CHOICES).map((x) => choice(`${x.id} · ${x.title.replace(/^\[[^\]]*\]\s*/, "")}`, x.id)) };
    }
    case "epic": {
      const b = await bundleOf(env);
      if (!b) return noProject;
      const exact = b.epics.find((e) => e.id.toLowerCase() === text.toLowerCase() || e.key?.toLowerCase() === text.toLowerCase());
      if (exact) return { ok: true, value: exact.id };
      const { match, ambiguous } = fuzzyFind(text.replace(/^epic\s+/i, ""), b.epics, (e) => [e.title]);
      if (match) return { ok: true, value: match.id };
      const pool = ambiguous.length ? ambiguous : b.epics;
      return { ok: false, message: `I couldn't find epic "${text}" in ${b.project.name}.`, options: pool.slice(0, MAX_CHOICES).map((e) => choice(e.title, e.id)) };
    }
    case "requirement": {
      const b = await bundleOf(env);
      if (!b) return noProject;
      const m = /^br\s*-?\s*(\d+)$/i.exec(text);
      const ref = m ? `BR-${m[1]}` : text.toUpperCase();
      const row = b.trace.find((r) => r.brRef.toUpperCase() === ref);
      if (row) return { ok: true, value: row.brRef };
      return { ok: false, message: `${b.project.name} has no requirement ${text}.`, options: b.trace.slice(0, MAX_CHOICES).map((r) => choice(r.brRef)) };
    }
    case "change": {
      const b = await bundleOf(env);
      if (!b) return noProject;
      const exact = b.changeReviews.find((c) => c.id.toLowerCase() === text.toLowerCase());
      if (exact) return { ok: true, value: exact.id };
      const { match } = fuzzyFind(text, b.changeReviews, (c) => [c.label, c.summary]);
      if (match) return { ok: true, value: match.id };
      return { ok: false, message: `I couldn't find change "${text}" in ${b.project.name}.`, options: b.changeReviews.slice(0, MAX_CHOICES).map((c) => choice(c.label, c.id)) };
    }
    case "stage-note": {
      const b = await bundleOf(env);
      if (!b) return noProject;
      const notes = STAGES.flatMap((s) => b.project.stages[s.id].notes);
      const exact = notes.find((n) => n.id === text);
      if (exact) return { ok: true, value: exact.id };
      const { match } = fuzzyFind(text, notes, (n) => [n.text]);
      if (match) return { ok: true, value: match.id };
      return { ok: false, message: `I couldn't find that note in ${b.project.name}.`, options: notes.slice(0, MAX_CHOICES).map((n) => choice(n.text.length > 40 ? `${n.text.slice(0, 40)}…` : n.text, n.id)) };
    }
    case "note": {
      if (deictic && ctx.page.noteId) return { ok: true, value: ctx.page.noteId };
      if (/^[a-z-]+\/[a-z0-9][a-z0-9/-]*$/.test(text)) return { ok: true, value: text };
      const { hits } = await ctx.world.memorySearch(text, 6);
      const ids = [...new Set(hits.map((h) => (h.kind === "card" ? h.id : (h.note ?? h.id.split("#")[0]))))];
      const named = hits.find((h) => h.kind === "card" && h.title && norm(h.title) === norm(text));
      if (named) return { ok: true, value: named.id };
      if (ids.length === 1) return { ok: true, value: ids[0] };
      if (!ids.length) return { ok: false, message: `No memory note matches "${text}".` };
      return { ok: false, message: `Several memory notes match "${text}".`, options: ids.slice(0, MAX_CHOICES).map((id) => choice(id)) };
    }
    case "workflow": {
      const flows = await ctx.world.workflows();
      const { match, ambiguous } = fuzzyFind(text.replace(/\s+workflow$/i, ""), flows, (w) => [w.name, w.id]);
      if (match) return { ok: true, value: match.name };
      const pool = ambiguous.length ? ambiguous : flows;
      return { ok: false, message: `I couldn't find workflow "${text}".`, options: pool.slice(0, MAX_CHOICES).map((w) => choice(w.name)) };
    }
    case "person":
      return text.length <= 60 ? { ok: true, value: text.replace(/\b\w/g, (c) => c.toUpperCase()) } : { ok: false, message: "That name is too long." };
    case "enum": {
      const values = spec.values ?? [];
      const q = norm(text).replace(/^(?:the|a|an)\s+/, "");
      const hit = values.find((v) => norm(v) === q) ?? values.find((v) => spec.synonyms?.[v]?.some((s) => norm(s) === q));
      if (hit) return { ok: true, value: hit };
      return { ok: false, message: `"${text}" isn't one of the options.`, options: values.map((v) => choice(v)) };
    }
    case "number": {
      const q = norm(text).replace(/^(?:wave|number|no)\s+/, "");
      const n = NUMBER_WORDS.indexOf(q) >= 0 ? NUMBER_WORDS.indexOf(q) : Number(q);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, message: `"${text}" isn't a number.` };
    }
    case "boolean": {
      const q = norm(text);
      if (/^(?:yes|y|true|on|enable|enabled|ok|sure|consistent|correct)$/.test(q)) return { ok: true, value: true };
      if (/^(?:no|n|false|off|disable|disabled|inconsistent|wrong)$/.test(q)) return { ok: true, value: false };
      return { ok: false, message: "Yes or no?", options: [choice("Yes"), choice("No")] };
    }
    case "json": {
      try {
        const v: unknown = JSON.parse(raw);
        if (v && typeof v === "object" && !Array.isArray(v)) return { ok: true, value: v };
      } catch {
        // fall through
      }
      return { ok: false, message: 'That isn\'t a JSON object, e.g. {"project": "demo"}.' };
    }
    case "text":
      return { ok: true, value: text };
  }
}

/** The page's value for a parameter, if the kind has one and the spec allows it. */
export function pageDefault(spec: ParamSpec, ctx: ToolContext): unknown {
  if (spec.fromPage === false) return undefined;
  switch (spec.kind) {
    case "project":
      return ctx.page.projectId;
    case "stage":
      return ctx.page.stage;
    case "run":
      return ctx.page.runId;
    case "note":
      return ctx.page.noteId;
    default:
      return undefined;
  }
}

const ASK: Partial<Record<ParamSpec["kind"], string>> = {
  project: "Which project?",
  stage: "Which stage?",
  run: "Which run?",
  task: "Which task?",
  epic: "Which epic?",
  requirement: "Which requirement?",
  change: "Which change?",
  "stage-note": "Which note?",
  doc: "Which document?",
  note: "Which memory note?",
  workflow: "Which workflow?",
  person: "Who should I act as?",
  page: "Which page?",
  number: "Which number?",
  boolean: "Yes or no?",
};

/** The question for a missing required parameter. */
export function askFor(name: string, spec: ParamSpec): string {
  return spec.ask ?? ASK[spec.kind] ?? (spec.kind === "text" ? `What should the ${name.replace(/([A-Z])/g, " $1").toLowerCase()} be?` : `What ${name}?`);
}

/** Chips offered with the question. */
export async function optionsFor(env: SlotEnv): Promise<Choice[]> {
  const { ctx, spec } = env;
  try {
    switch (spec.kind) {
      case "project":
        return (await ctx.world.projects()).slice(0, MAX_CHOICES).map((p) => choice(p.name));
      case "stage":
        return STAGES.map((s) => choice(s.title));
      case "doc":
        return [choice("BRD"), choice("AAD"), choice("Plan")];
      case "page":
        return ["Home", "Inbox", "Projects", "Runs", "Memory", "Settings"].map((p) => choice(p));
      case "enum":
        return (spec.values ?? []).map((v) => choice(v));
      case "boolean":
        return [choice("Yes"), choice("No")];
      case "run":
        return (await ctx.world.runs())
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, MAX_CHOICES)
          .map((r) => choice(`${r.workflow} · ${r.runId}`, r.runId));
      case "workflow":
        return (await ctx.world.workflows()).slice(0, MAX_CHOICES).map((w) => choice(w.name));
      case "task": {
        const b = await bundleOf(env);
        return (b?.tasks ?? []).slice(0, MAX_CHOICES).map((x) => choice(`${x.id} · ${x.title.replace(/^\[[^\]]*\]\s*/, "")}`, x.id));
      }
      case "epic": {
        const b = await bundleOf(env);
        return (b?.epics ?? []).slice(0, MAX_CHOICES).map((e) => choice(e.title, e.id));
      }
      case "requirement": {
        const b = await bundleOf(env);
        return (b?.trace ?? []).slice(0, MAX_CHOICES).map((r) => choice(r.brRef));
      }
      case "change": {
        const b = await bundleOf(env);
        return (b?.changeReviews ?? []).slice(0, MAX_CHOICES).map((c) => choice(c.label, c.id));
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
}

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A value as the confirmation card shows it: names instead of ids. */
export async function describeValue(value: unknown, env: SlotEnv): Promise<string> {
  const { ctx, spec } = env;
  try {
    switch (spec.kind) {
      case "project":
        return await ctx.world.projectName(String(value));
      case "stage":
        return stageDef(value as StageId).title;
      case "task": {
        const t = (await bundleOf(env))?.tasks.find((x) => x.id === value);
        return t ? `${t.id} · ${clip(t.title.replace(/^\[[^\]]*\]\s*/, ""), 60)}` : String(value);
      }
      case "epic":
        return (await bundleOf(env))?.epics.find((e) => e.id === value)?.title ?? String(value);
      case "change":
        return (await bundleOf(env))?.changeReviews.find((c) => c.id === value)?.label ?? String(value);
      case "stage-note": {
        const b = await bundleOf(env);
        const note = b ? STAGES.flatMap((st) => b.project.stages[st.id].notes).find((n) => n.id === value) : undefined;
        return note ? `“${clip(note.text, 100)}”` : String(value);
      }
      case "doc":
        return String(value).toUpperCase();
      case "boolean":
        return value ? "Yes" : "No";
      case "json":
        return clip(JSON.stringify(value));
      case "text":
        return `“${clip(String(value), 140)}”`;
      default:
        return String(value);
    }
  } catch {
    return String(value);
  }
}

export { isRequired };
