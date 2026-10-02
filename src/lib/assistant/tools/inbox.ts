import { weft } from "@/lib/api/client";
import { stageDef, type InboxItem, type StageId } from "@/lib/delivery/types";
import { formatRelative, plural } from "@/lib/format";
import { humanKindMeta, inboxItemText, inboxTierMeta, type Tone } from "@/lib/weft/labels";
import type { PendingEntry } from "@/lib/weft/types";
import { defineTool } from "../define";
import { fuzzyFind, resolveSlot } from "../slots";
import type { ResultBlock, ResultItem, ToolContext } from "../types";

const enc = encodeURIComponent;
const MAX_ROWS = 8;

type HumanItem = Extract<InboxItem, { kind: "human" }>;
const isHuman = (i: InboxItem): i is HumanItem => i.kind === "human";

/** The Inbox's groups (components/inbox/bits.tsx): the awaiting_approval tier splits into approvals and actions. */
type Group = "blocking_run" | "approvals" | "ready_to_start" | "fyi";

const GROUPS: ReadonlyArray<{ id: Group; label: string; tone: Tone }> = [
  { id: "blocking_run", label: inboxTierMeta("blocking_run").label, tone: "attention" },
  { id: "approvals", label: "Approvals", tone: "review" },
  { id: "ready_to_start", label: "Ready to start", tone: "running" },
  { id: "fyi", label: inboxTierMeta("fyi").label, tone: "neutral" },
];

const groupOf = (i: InboxItem): Group => (i.tier === "awaiting_approval" ? (i.kind === "action" ? "ready_to_start" : "approvals") : i.tier);
const sinceOf = (i: InboxItem) => (i.kind === "human" ? i.entry.createdAt : i.since);

function kindOf(i: InboxItem): { label: string; tone: Tone } {
  switch (i.kind) {
    case "human": {
      const m = humanKindMeta(i.entry.kind);
      return { label: m.label, tone: "attention" };
    }
    case "stage-gate":
      return { label: "Stage gate", tone: "review" };
    case "epics":
      return { label: "Epics", tone: "review" };
    case "action":
      return { label: "Ready to start", tone: "running" };
    case "notice":
      return i.level === "error" ? { label: "Error", tone: "danger" } : i.level === "warning" ? { label: "Warning", tone: "attention" } : { label: "Notice", tone: "neutral" };
  }
}

const inboxRow = (i: InboxItem): ResultItem => ({
  title: inboxItemText(i),
  subtitle: `${i.projectName} · ${stageDef(i.stage).title}`,
  meta: formatRelative(sinceOf(i)),
  href: i.href,
  status: kindOf(i),
});

const firstLine = (s: string, max = 120) => {
  const line = s.split("\n").find((l) => l.trim()) ?? s;
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

// ---------------------------------------------------------------------------------------------
// Pending human requests, oldest first, joined with their inbox item (project, stage, href)
// ---------------------------------------------------------------------------------------------

interface Waiting {
  entry: PendingEntry;
  item?: HumanItem;
}

/** Every request a person answers (tool gates excluded, as in the Inbox), oldest first. */
async function waitingRequests(ctx: ToolContext): Promise<{ list: Waiting[]; gates: number }> {
  const [{ pending }, inbox] = await Promise.all([ctx.world.pending(), ctx.world.inbox()]);
  const items = new Map(inbox.filter(isHuman).map((i) => [`${i.entry.runId}:${i.entry.id}`, i]));
  const list = pending
    .filter((p) => p.kind !== "gate")
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((entry) => ({ entry, item: items.get(`${entry.runId}:${entry.id}`) }));
  return { list, gates: pending.length - list.length };
}

function requestRow({ entry, item }: Waiting, n?: number): ResultItem {
  const kind = humanKindMeta(entry.kind);
  return {
    title: `${n ? `${n}. ` : ""}${firstLine(entry.question)}`,
    subtitle: item ? `${item.projectName} · ${stageDef(item.stage).title} · ${entry.workflow} ${entry.runId}` : `${entry.workflow} · ${entry.runId}`,
    meta: formatRelative(entry.createdAt),
    href: item?.href ?? `/runs/${enc(entry.rootRunId)}?tab=requests`,
    status: { label: kind.label, tone: kind.tone },
  };
}

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "first", "2nd", "#3", "number 4", "last": a 1-based position, "last", or undefined. */
function positionOf(raw: string): number | "last" | undefined {
  const q = raw
    .toLowerCase()
    .trim()
    .replace(/^(?:the|number|no\.?)\s+/, "")
    .replace(/\s+(?:one|request|question)$/, "")
    .replace(/^#\s*/, "");
  if (/^(?:last|latest|newest|most recent)$/.test(q)) return "last";
  if (/^(?:first|oldest|earliest|next|top)$/.test(q)) return 1;
  if (ORDINALS.includes(q)) return ORDINALS.indexOf(q) + 1;
  if (NUMBERS.includes(q)) return NUMBERS.indexOf(q) + 1;
  const m = /^(\d+)(?:st|nd|rd|th)?$/.exec(q);
  return m ? Number(m[1]) : undefined;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Narrow by free words: a stage ("BRD"), a run id or workflow, a project name, or words of the question. */
async function pickByWords(list: Waiting[], raw: string, ctx: ToolContext): Promise<Waiting[]> {
  const which = raw.replace(/^(?:about|on|for|regarding|re)\s+/i, "");
  const stage = await resolveSlot(which, { ctx, input: {}, spec: { kind: "stage", description: "" } });
  if (stage.ok) return list.filter((w) => w.item?.stage === (stage.value as StageId));
  const q = norm(which);
  const byRun = list.filter((w) => w.entry.runId.startsWith(which) || w.entry.rootRunId.startsWith(which) || norm(w.entry.workflow) === q || norm(w.entry.rootWorkflow) === q);
  if (byRun.length) return byRun;
  const projects = [...new Map(list.flatMap((w) => (w.item ? [[w.item.projectId, w.item] as const] : []))).values()];
  const { match } = fuzzyFind(which, projects, (p) => [p.projectName, p.projectId]);
  if (match) return list.filter((w) => w.item?.projectId === match.projectId);
  const words = q.split(" ").filter((w) => w.length > 2);
  return list.filter((w) => {
    const text = norm(w.entry.question);
    return text.includes(q) || (words.length > 0 && words.every((x) => text.includes(x)));
  });
}

function whichLabel(which: string | undefined): string {
  const pos = which ? positionOf(which) : 1;
  if (pos === "last") return "the newest pending request";
  if (pos === 1) return "the oldest pending request";
  if (pos !== undefined) return `pending request ${pos}`;
  return `the pending request matching “${which}”`;
}

// ---------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------

/** What is waiting on a person: the Inbox, weft's pending human requests, and answering one. */
export const inboxTools = [
  defineTool({
    name: "whats_waiting",
    group: "inbox",
    title: "Show what's waiting for you",
    description:
      "List everything waiting on a person across projects, as the Inbox groups it: runs blocked on a human request first, then approvals (stage gates, epics), work ready to start, and FYI notices.",
    effect: "read",
    params: { projectId: { kind: "project", description: "Only this project's items; every project when left out", required: false, fromPage: false } },
    utterances: [
      "(what's|what is|whats) waiting [on me|for my input|for my answer]",
      "(what's|what is|whats) waiting [for me] (in|on|for) [project] {projectId}",
      "(what|anything|what else) (needs|need|requires) [my] (attention|input|review|approval|answer|answers)",
      "(what|anything) (needs|requires) [my] (attention|input|approval) (in|on|for) [project] {projectId}",
      "(anything|is there anything|is anything) [new] [waiting|pending|to do|to review|on my plate|that needs me] [on me|for me]",
      "(what's|what is|whats) (on my plate|in my inbox|on my list|my todo list|my to do list)",
      "(show|list|summarize|summarise) [me] [all] [my|the] inbox (items|list|contents)",
      "what should i (do|work on|look at|answer|review) [next|first|today]",
    ],
    examples: ["What's waiting for me?", "What needs my attention?", "Show my inbox items"],
    covers: ["delivery.inbox"],
    summary: async ({ projectId }, ctx) => (projectId ? `Show what's waiting in ${await ctx.world.projectName(projectId)}` : "Show what's waiting for you"),
    run: async ({ projectId }, ctx) => {
      const all = await ctx.world.inbox();
      const items = projectId ? all.filter((i) => i.projectId === projectId) : all;
      const where = projectId ? ` in ${await ctx.world.projectName(projectId)}` : "";
      if (!items.length) return { text: `Nothing is waiting on you${where}. Runs, gates and approvals that need a person show up here.` };
      const groups = GROUPS.map((g) => ({ g, list: items.filter((i) => groupOf(i) === g.id) })).filter((x) => x.list.length);
      const count = (id: Group) => items.filter((i) => groupOf(i) === id).length;
      const parts = [
        count("blocking_run") && `${count("blocking_run")} blocking a run`,
        count("approvals") && plural(count("approvals"), "approval"),
        count("ready_to_start") && `${count("ready_to_start")} ready to start`,
        count("fyi") && `${count("fyi")} FYI`,
      ].filter(Boolean);
      const blocks: ResultBlock[] = groups.map(({ g, list }) => ({
        type: "items",
        title: `${g.label} (${list.length})`,
        items: [...list].sort((a, b) => (g.id === "blocking_run" ? sinceOf(a) - sinceOf(b) : 0)).slice(0, MAX_ROWS).map(inboxRow),
        ...(list.length > MAX_ROWS ? { more: { label: `All ${list.length} in the Inbox`, href: "/inbox" } } : {}),
      }));
      const hint = count("blocking_run") ? " Runs stay paused until someone answers; say “answer the first request” to answer one here." : "";
      return { text: `${plural(items.length, "thing")} ${items.length === 1 ? "is" : "are"} waiting${where}: ${parts.join(", ")}.${hint}`, blocks };
    },
  }),
  defineTool({
    name: "list_pending_requests",
    group: "inbox",
    title: "List pending requests",
    description:
      "List the weft human requests (questions, reviews, approvals) that are holding runs, oldest first and numbered, with the project and stage they belong to. Tool gates decided by the approval policy are counted but not listed.",
    effect: "read",
    params: { projectId: { kind: "project", description: "Only this project's requests; every project when left out", required: false, fromPage: false } },
    utterances: [
      "list [all] [the] [pending|open|waiting|unanswered|human] (requests|questions|reviews)",
      "show [me] [all] [the] (pending|open|waiting|unanswered|human) (requests|questions|reviews)",
      "(list|show [me]) [all] [the] [pending|open|waiting|unanswered] (requests|questions) (for|on|in|from) [project] {projectId}",
      "(which|what) (requests|questions|reviews) are (pending|open|waiting|unanswered) [on me]",
      "(which|what) (requests|questions|reviews) are (pending|open|waiting) (for|on|in) [project] {projectId}",
      "(any|are there any|how many) (pending|open|waiting|unanswered) (requests|questions|reviews)",
      "how many (requests|questions|reviews) are (pending|open|waiting)",
    ],
    examples: ["List pending requests", "Which questions are waiting?"],
    covers: ["weft.pending", "delivery.inbox"],
    summary: async ({ projectId }, ctx) => (projectId ? `List the pending requests of ${await ctx.world.projectName(projectId)}` : "List pending requests"),
    run: async ({ projectId }, ctx) => {
      const { list: all, gates } = await waitingRequests(ctx);
      const list = projectId ? all.filter((w) => w.item?.projectId === projectId) : all;
      const where = projectId ? ` in ${await ctx.world.projectName(projectId)}` : "";
      const gateNote = gates && !projectId ? ` ${plural(gates, "tool gate")} also ${gates === 1 ? "waits" : "wait"} on the approval policy.` : "";
      if (!list.length) return { text: `No human request is pending${where}.${gateNote}` };
      const hint = projectId ? `Say “answer the first request${where.replace(/^ in/, " for")}” to answer one here.` : list.length > 1 ? "Say “answer request 2” (or “answer the first one”) to answer one here." : "Say “answer the first request” to answer it here.";
      return {
        text: `${plural(list.length, "request")} ${list.length === 1 ? "is" : "are"} waiting${where}, oldest first. ${hint}${gateNote}`,
        blocks: [{ type: "items", items: list.slice(0, 12).map((w, i) => requestRow(w, i + 1)), ...(list.length > 12 ? { more: { label: `All ${list.length} in the Inbox`, href: "/inbox" } } : {}) }],
      };
    },
  }),
  defineTool({
    name: "answer_request",
    group: "inbox",
    title: "Answer a pending request",
    description:
      "Find one pending human request and show its answer form (the same one the Inbox shows), so the person can answer it in the chat. Pick it by position ('first', '2', 'last'), by project, stage, run, or words from the question; with several matches the oldest is shown.",
    effect: "read",
    params: {
      which: {
        kind: "text",
        description: "Which request: 'first', 'second', 'last' or a number from the pending list, or words that pick it out (a stage such as 'BRD', a project, a run id or workflow, words of the question)",
        required: false,
      },
      projectId: { kind: "project", description: "Only requests of this project; defaults to the page's project", required: false },
      stage: { kind: "stage", description: "Only requests of this stage; defaults to the page's stage", required: false },
      runId: { kind: "run", description: "Only requests of this run and the runs it started; defaults to the page's run", required: false },
    },
    utterances: [
      "(answer|reply to|respond to|handle|pick up) [the|my|this|that] [pending] (request|question|review|requests|questions)",
      "(answer|reply to|respond to|handle) (it|this|that|this one|that one)",
      "(answer|reply to|respond to|review|handle|pick up|show [me]|open) [the] {which} [pending] (request|requests|question|questions|one)",
      "(answer|reply to|respond to|handle|pick up|show [me]|open) [the] {which} (review|reviews|approval|approvals)",
      "(answer|reply to|respond to|review|handle|show [me]|open) [the] [pending] (request|question) (number|no) {which}",
      "(answer|reply to|respond to|handle) [the] [pending] (request|question) {which}",
      "(answer|reply to|respond to|review|handle) [the] [pending] (request|question|review|requests|questions|reviews) (for|on|in|from) [project] {projectId}",
      "(show [me]|open|get [me]) [the] [pending] (request|question) (for|on|in|from) [project] {projectId}",
      "(answer|reply to|respond to|review|handle|show [me]|open) [the] {which} (request|requests|question|questions) (for|on|in|from) [project] {projectId}",
      "(answer|reply to|respond to|review|handle|show [me]|open) [the] [pending] (request|question|review|requests|questions) (of|for|on|in|from) [the] run {runId}",
    ],
    examples: ["Answer the first request", "Show me the request for {project}", "Review the BRD questions"],
    // The request block renders the Inbox's HumanRequestCard, which answers through weft.answer.
    covers: ["weft.pending", "weft.runPending", "weft.answer", "delivery.inbox"],
    summary: async ({ which, projectId, stage, runId }, ctx) => {
      const words = !!which && positionOf(which) === undefined;
      const scope = [projectId && `in ${await ctx.world.projectName(projectId)}`, stage && !words && `at ${stageDef(stage).title}`, runId && `of run ${runId}`].filter(Boolean).join(" ");
      const label = whichLabel(which);
      return `Show ${label}${scope ? ` ${scope}` : ""}`;
    },
    run: async ({ which, projectId, stage, runId }, ctx) => {
      const { list: all } = await waitingRequests(ctx);
      let list = all;
      if (runId) {
        // /pending of a run includes its live descendants; each request is answered on its own run.
        const own = await weft.runPending(runId);
        const keys = new Set(own.map((r) => `${r.runId}:${r.id}`));
        list = all.filter((w) => keys.has(`${w.entry.runId}:${w.entry.id}`));
        if (!list.length && own.some((r) => r.kind !== "gate")) {
          const runs = await ctx.world.runs();
          const workflowOf = (id: string) => runs.find((r) => r.runId === id)?.workflow ?? "";
          list = own
            .filter((r) => r.kind !== "gate")
            .map((r) => ({ entry: { ...r, workflow: workflowOf(r.runId), rootRunId: runId, rootWorkflow: workflowOf(runId) } }));
        }
      }
      if (projectId) list = list.filter((w) => w.item?.projectId === projectId);
      const position = which ? positionOf(which) : 1;
      const picked = which && position === undefined ? await pickByWords(list, which, ctx) : list;
      // Words naming a stage pick it even on another stage's page.
      const byStage = stage && !(which && position === undefined) ? picked.filter((w) => w.item?.stage === stage) : picked;

      const where = [projectId && `in ${await ctx.world.projectName(projectId)}`, stage && !(which && position === undefined) && `at ${stageDef(stage).title}`, runId && `of run ${runId}`].filter(Boolean).join(" ");
      if (!byStage.length) {
        const inProject = projectId ? all.filter((w) => w.item?.projectId === projectId) : [];
        const rest = inProject.length ? inProject : all;
        const others = rest.length ? ` ${plural(rest.length, "request")} ${rest.length === 1 ? "is" : "are"} waiting${where || inProject.length ? " elsewhere" : ""}${inProject.length ? ` in ${await ctx.world.projectName(projectId!)}` : ""}:` : "";
        const text = which && position === undefined ? `No pending request matches “${which}”${where ? ` ${where}` : ""}.${others}` : `Nothing is waiting on you${where ? ` ${where}` : ""}.${others}`;
        return { text, blocks: rest.length ? [{ type: "items", items: rest.slice(0, MAX_ROWS).map((w) => requestRow(w)) }] : [] };
      }
      const index = position === "last" ? byStage.length - 1 : (position ?? 1) - 1;
      const chosen = byStage[index];
      if (!chosen) return { text: `Only ${plural(byStage.length, "request")} ${byStage.length === 1 ? "is" : "are"} waiting${where ? ` ${where}` : ""}.`, blocks: [{ type: "items", items: byStage.slice(0, MAX_ROWS).map((w, i) => requestRow(w, i + 1)) }] };

      const { entry, item } = chosen;
      const kind = humanKindMeta(entry.kind).label.toLowerCase();
      const place = item ? ` in ${item.projectName} · ${stageDef(item.stage).title}` : "";
      const of = byStage.length > 1 ? ` (${index + 1} of ${byStage.length})` : "";
      const left = byStage.length - index - 1;
      const scoped = !!(projectId || stage || runId || (which && position === undefined));
      const next = left <= 0 ? "" : scoped ? ` ${plural(left, "more request")} ${left === 1 ? "is" : "are"} waiting here.` : ` Say “answer request ${index + 2}” for the next one.`;
      return {
        text: `Here's the ${kind} from ${entry.workflow} ${entry.runId}${place}${of}. Answer it below; the run continues once you submit.${next}`,
        blocks: [{ type: "request", runId: entry.runId, request: entry, ...(item ? { projectId: item.projectId } : {}) }],
      };
    },
  }),
] as const;
