import "server-only";
/**
 * The "revise" half of dev-plan: applies a developer's feedback and new notes to the task list the
 * way a planning agent would, and lists every change so the next round's report can show it.
 * Recognised instructions (case-insensitive, one per sentence or clause):
 *   split T-6 · move T-8 to wave 2 · drop T-5 · T-9 depends on T-7 · size T-4 L
 *   add AC to T-4: <text> · Q4: <answer> (resolves the question and unblocks tasks)
 *   "<repo A> … <repo B> lands first" / "<repo B> before <repo A>": repo B's change is its own
 *   task (added when the plan has none) and repo A's tasks depend on it
 *   "T-5: <text>" names a task: the text becomes an acceptance criterion on it
 * Anything else becomes an acceptance criterion on the task it is most about, except for round-1
 * developer notes, where it is returned in `unapplied` so the plan can say so.
 */
import type { PlannedTask, PlanReport } from "@/lib/weft/workflows";
import { repoKind } from "@/server/mock/content/delivery/templates/repos";
import { clip, compareTaskIds, significantWords, stripScope } from "./util";

export interface RevisionResult {
  tasks: PlannedTask[];
  report: PlanReport;
  changes: string[];
  /** Clauses no instruction matched and nothing was applied for (only with freeText: false). */
  unapplied: string[];
}

const REPOS = ["api-contracts", "api-gateway", "customer-service-v2", "website-customer-portal", "website-myaccount", "pww-automation", "terraform-auth0"];

/** Repo names a sentence mentions, in order: the plan's repos plus the ones the planner knows. */
function reposIn(sentence: string, tasks: readonly PlannedTask[]): Array<{ repo: string; at: number }> {
  const lower = sentence.toLowerCase();
  const names = [...new Set([...tasks.map((t) => t.repo), ...REPOS])].filter(Boolean);
  return names
    .map((repo) => ({ repo, at: lower.indexOf(repo.toLowerCase()) }))
    .filter((r) => r.at >= 0)
    .sort((a, b) => a.at - b.at);
}

/**
 * "Split the customer-service-v2 endpoint work so the api-contracts change lands first": the repo
 * that goes first, and the ones that wait for it.
 */
function repoOrder(sentence: string, tasks: readonly PlannedTask[]): { first: string; then: string[] } | undefined {
  const found = reposIn(sentence, tasks);
  if (found.length < 2) return undefined;
  const lower = sentence.toLowerCase();
  const firstWord = /\b(lands?|goes|go|ships?|merges?|comes?|is done|happens?)\s+first\b|\bfirst\b/.exec(lower);
  const before = /\b(before|ahead of|prior to)\b/.exec(lower);
  const after = /\b(after|once)\b/.exec(lower);
  let first: string | undefined;
  if (firstWord) first = [...found].reverse().find((r) => r.at < firstWord.index)?.repo ?? found[0].repo;
  else if (before) first = found.find((r) => r.at < before.index)?.repo;
  else if (after) first = found.find((r) => r.at > after.index)?.repo;
  if (!first) return undefined;
  return { first, then: found.map((r) => r.repo).filter((r) => r !== first) };
}

/** Moves tasks that depend (transitively) on an earlier-wave task to a later wave. */
function settleWaves(tasks: PlannedTask[]): void {
  for (let pass = 0; pass < tasks.length; pass++) {
    let moved = false;
    for (const t of tasks) {
      const need = Math.max(0, ...t.dependencies.map((d) => tasks.find((x) => x.id === d)?.wave ?? 0)) + 1;
      if (t.dependencies.length && t.wave < need) {
        t.wave = need;
        moved = true;
      }
    }
    if (!moved) return;
  }
}

const SMALLER: Record<PlannedTask["size"], PlannedTask["size"]> = { L: "M", M: "S", S: "XS", XS: "XS" };

function clone(tasks: readonly PlannedTask[]): PlannedTask[] {
  return tasks.map((t) => ({
    ...t,
    tags: [...t.tags],
    dependencies: [...t.dependencies],
    relatedFiles: [...t.relatedFiles],
    acceptanceCriteria: t.acceptanceCriteria.map((a) => ({ ...a })),
    traces: [...t.traces],
  }));
}

function nextTaskId(tasks: readonly PlannedTask[]): string {
  const max = tasks.reduce((n, t) => Math.max(n, Number(/(\d+)$/.exec(t.id)?.[1] ?? 0)), 0);
  return `T-${max + 1}`;
}

function renumber(acs: PlannedTask["acceptanceCriteria"]): PlannedTask["acceptanceCriteria"] {
  return acs.map((a, i) => ({ id: `AC-${i + 1}`, text: a.text }));
}

function addAc(task: PlannedTask, text: string): string {
  const id = `AC-${task.acceptanceCriteria.length + 1}`;
  task.acceptanceCriteria.push({ id, text: clip(text.replace(/^[\s:,-]+/, ""), 220) });
  return id;
}

/** The task a free-text sentence is most about: a named id, else the best word overlap. */
function relatedTask(tasks: readonly PlannedTask[], text: string): PlannedTask | undefined {
  const named = /\bT-\d+\b/.exec(text)?.[0];
  if (named) {
    const t = tasks.find((x) => x.id === named);
    if (t) return t;
  }
  const want = new Set(significantWords(text).map((w) => w.toLowerCase()).filter((w) => w.length > 3));
  let best: { t: PlannedTask; score: number } | undefined;
  for (const t of tasks) {
    const have = significantWords(`${t.title} ${t.description} ${t.repo}`).map((w) => w.toLowerCase());
    const score = have.filter((w) => want.has(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { t, score };
  }
  return best?.t ?? tasks[0];
}

function clauses(text: string): string[] {
  return text
    .split(/(?<=[.;!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function applyPlanFeedback(
  input: readonly PlannedTask[],
  report: PlanReport,
  feedback: string,
  newNotes: readonly string[],
  /** false: free text that matches no instruction is left alone (round-1 developer notes). */
  opts: { freeText?: boolean } = {},
): RevisionResult {
  const freeText = opts.freeText ?? true;
  let tasks = clone(input);
  const next: PlanReport = {
    assumptions: [...report.assumptions],
    openQuestions: [...report.openQuestions],
    uncovered: [...report.uncovered],
    risks: [...report.risks],
  };
  const changes: string[] = [];
  const find = (id: string) => tasks.find((t) => t.id.toLowerCase() === id.toLowerCase());
  const leftovers: string[] = [];

  for (const sentence of clauses(feedback)) {
    let matched = false;

    const order = /\bT-\d+\b/.test(sentence) ? undefined : repoOrder(sentence, tasks);
    const waiting = order ? tasks.filter((t) => order.then.includes(t.repo)) : [];
    if (order && waiting.length) {
      matched = true;
      let firsts = tasks.filter((t) => t.repo === order.first);
      if (!firsts.length) {
        const base = waiting[0];
        const contract = repoKind(order.first) === "contracts";
        const added: PlannedTask = {
          ...base,
          id: nextTaskId(tasks),
          title: `[${order.first}] ${contract ? "Contract for" : "Prerequisite for"} ${clip(stripScope(base.title).replace(/:\s*read endpoint$/i, ""), 70)}`,
          description: `Split out of ${base.id} at the developer's request, so the ${order.first} change lands before ${waiting.map((t) => t.id).join(", ")}.`,
          tags: [contract ? "contracts" : repoKind(order.first)],
          dependencies: [],
          relatedFiles: [],
          acceptanceCriteria: [
            { id: "AC-1", text: `The ${order.first} change covers what ${waiting.map((t) => t.id).join(", ")} ${waiting.length === 1 ? "needs" : "need"}` },
            { id: "AC-2", text: contract ? "The spec passes redocly lint with no breaking-change findings" : `${order.first} checks pass on the branch` },
          ],
          type: "task",
          repo: order.first,
          size: contract ? "XS" : "S",
          wave: Math.max(1, Math.min(...waiting.map((t) => t.wave)) - 1),
          traces: [...base.traces],
        };
        delete added.blockedBy;
        tasks.push(added);
        firsts = [added];
        changes.push(`Added ${added.id} ${added.title}, split out of ${base.id}`);
      }
      for (const t of waiting) {
        const add = firsts.filter((f) => f !== t && !t.dependencies.includes(f.id)).map((f) => f.id);
        if (!add.length) continue;
        t.dependencies.push(...add);
        changes.push(`${t.id} now depends on ${add.join(", ")}, so the ${order.first} change lands first`);
      }
      const before = new Map(tasks.map((t) => [t.id, t.wave]));
      settleWaves(tasks);
      for (const t of tasks) if (before.get(t.id) !== t.wave) changes.push(`Moved ${t.id} from wave ${before.get(t.id)} to wave ${t.wave}`);
    }

    for (const m of sentence.matchAll(/\bsplit\s+(T-\d+)/gi)) {
      const t = find(m[1]);
      if (!t) continue;
      matched = true;
      const id = nextTaskId(tasks);
      const keep = Math.max(1, Math.ceil(t.acceptanceCriteria.length / 2));
      const moved = t.acceptanceCriteria.slice(keep);
      const part2: PlannedTask = {
        ...t,
        id,
        title: `${t.title} (part 2)`,
        description: `Second half of ${t.id}, split at review. ${t.description}`.trim(),
        dependencies: [t.id],
        acceptanceCriteria: renumber(moved.length ? moved : [{ id: "AC-1", text: `Completes the work started in ${t.id}` }]),
        size: SMALLER[t.size],
        relatedFiles: [...t.relatedFiles],
        tags: [...t.tags],
        traces: [...t.traces],
      };
      delete part2.blockedBy;
      t.title = `${t.title} (part 1)`;
      t.acceptanceCriteria = renumber(t.acceptanceCriteria.slice(0, keep));
      t.size = SMALLER[t.size];
      tasks.push(part2);
      changes.push(
        `Split ${t.id} into ${t.id} and ${id}${moved.length ? ` (${moved.length} acceptance criteria moved to ${id})` : ""}`,
      );
    }

    for (const m of sentence.matchAll(/\b(?:move\s+)?(T-\d+)\s+(?:to|into|in)\s+wave\s+(\d+)/gi)) {
      const t = find(m[1]);
      const wave = Number(m[2]);
      if (!t || wave < 1 || t.wave === wave) continue;
      matched = true;
      changes.push(`Moved ${t.id} from wave ${t.wave} to wave ${wave}`);
      t.wave = wave;
    }

    for (const m of sentence.matchAll(/\b(?:drop|remove|delete)\s+(T-\d+)/gi)) {
      const t = find(m[1]);
      if (!t) continue;
      matched = true;
      tasks = tasks.filter((x) => x !== t);
      for (const x of tasks) x.dependencies = x.dependencies.filter((d) => d !== t.id);
      changes.push(`Removed ${t.id} ${t.title}`);
    }

    for (const m of sentence.matchAll(/\b(T-\d+)\s+(?:depends on|needs|after)\s+(T-\d+)/gi)) {
      const t = find(m[1]);
      const d = find(m[2]);
      if (!t || !d || t === d || t.dependencies.includes(d.id)) continue;
      matched = true;
      t.dependencies.push(d.id);
      changes.push(`${t.id} now depends on ${d.id}`);
    }

    for (const m of sentence.matchAll(/\b(?:size|resize)\s+(T-\d+)\s+(?:to\s+|as\s+)?(XS|S|M|L)\b/gi)) {
      const t = find(m[1]);
      const size = m[2].toUpperCase() as PlannedTask["size"];
      if (!t || t.size === size) continue;
      matched = true;
      changes.push(`Resized ${t.id} from ${t.size} to ${size}`);
      t.size = size;
    }

    const acM = /\badd\s+(?:an?\s+)?(?:AC|acceptance criteri(?:on|a))\s+(?:to|for|on)\s+(T-\d+)\s*[:,-]?\s*(.+)$/i.exec(sentence);
    if (acM) {
      const t = find(acM[1]);
      if (t) {
        matched = true;
        const id = addAc(t, acM[2]);
        changes.push(`Added ${id} to ${t.id}: ${clip(acM[2], 90)}`);
      }
    }

    const qM = /^\s*(Q\d+)\s*(?::|=|-|is answered|is resolved|answered|resolved)\s*(.*)$/i.exec(sentence);
    if (qM) {
      matched = true;
      const q = qM[1].toUpperCase();
      const before = next.openQuestions.length;
      next.openQuestions = next.openQuestions.filter((o) => !o.toUpperCase().startsWith(q));
      const unblocked = tasks.filter((t) => t.blockedBy?.toUpperCase().startsWith(q));
      for (const t of unblocked) delete t.blockedBy;
      const answer = qM[2].trim();
      if (answer) next.assumptions.push(`${q} answered at plan review: ${clip(answer, 160)}`);
      changes.push(
        `${before !== next.openQuestions.length ? "Resolved" : "Recorded an answer to"} ${q}${
          unblocked.length ? `; ${unblocked.map((t) => t.id).join(", ")} no longer blocked` : ""
        }`,
      );
    }

    // "T-5: cover the empty balance state" names its task: the rest is an acceptance criterion.
    const namedM = !matched ? /^\s*(T-\d+)\s*[:,-]\s*(.+)$/i.exec(sentence) : null;
    const named = namedM ? find(namedM[1]) : undefined;
    if (namedM && named && significantWords(namedM[2]).length >= 2) {
      matched = true;
      const id = addAc(named, namedM[2]);
      changes.push(`Added ${id} to ${named.id}: ${clip(namedM[2], 90)}`);
    }

    if (!matched) leftovers.push(sentence);
  }

  // Free-text feedback nobody matched becomes an acceptance criterion where it belongs, so the
  // developer can see it was applied rather than silently dropped.
  const rest = leftovers.join(" ").trim();
  let unapplied: string[] = [];
  if (freeText && rest && significantWords(rest).length >= 3) {
    const t = relatedTask(tasks, rest);
    if (t) {
      const id = addAc(t, rest);
      changes.push(`Added ${id} to ${t.id} from your feedback: ${clip(rest, 90)}`);
    }
  } else if (!freeText) unapplied = leftovers;

  newNotes.forEach((note, i) => {
    const text = note.trim();
    if (!text) return;
    const isFile = /^[\w./-]+\.(md|txt)$/.test(text);
    if (isFile) {
      next.assumptions.push(`Developer note file ${text} read for this round`);
      changes.push(`Read developer note ${text}`);
      return;
    }
    const t = relatedTask(tasks, text);
    if (!t) return;
    const id = addAc(t, text);
    changes.push(`Added ${id} to ${t.id} from developer note ${i + 1}: ${clip(text, 90)}`);
  });

  tasks.sort((a, b) => a.wave - b.wave || compareTaskIds(a.id, b.id));
  if (changes.length === 0 && freeText) changes.push("No structural change requested; plan re-checked against the BRD and AAD");
  return { tasks, report: next, changes, unapplied };
}
