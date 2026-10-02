import { delivery, weft } from "@/lib/api/client";
import { STAGES } from "@/lib/delivery/types";
import { formatBytes, formatDateTime, formatDuration, formatRelative, formatTokens, formatUsd, plural } from "@/lib/format";
import { humanKindMeta, runStatusMeta, stepStatusMeta, type Tone } from "@/lib/weft/labels";
import { TERMINAL_RUN_STATUSES, type FileStat, type RunDetail, type RunStatus, type StepStatus, type TreeNode } from "@/lib/weft/types";
import { defineTool } from "../define";
import type { ResultBlock, ResultItem, ToolContext } from "../types";

const enc = encodeURIComponent;
const runHref = (runId: string, tab?: string) => `/runs/${enc(runId)}${tab ? `?tab=${tab}` : ""}`;
const pill = (m: { label: string; tone: Tone }) => ({ label: m.label, tone: m.tone });
const clip = (s: string, n = 100) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const firstLine = (s: string) => clip(s.split("\n").find((l) => l.trim()) ?? s, 120);
const isTerminal = (s: RunStatus) => TERMINAL_RUN_STATUSES.includes(s);
/** A status for a sentence: "is complete", "is waiting for input". */
const statusWords = (s: RunStatus) => (s === "waiting_for_human" ? "waiting for input" : runStatusMeta(s).label.toLowerCase());

/** The real po-workspace workflows; the rest are mocks shaped like them (Settings → Workflows). */
const REAL_WORKFLOWS = new Set(["po-brd", "architect-aad"]);

/** "active" is the Runs page's group (planning, running, integrating, verifying); the rest are weft's statuses. */
const STATUSES = ["active", "planning", "executing", "waiting_for_human", "waiting_for_signal", "integrating", "verifying", "complete", "failed", "cancelled"] as const satisfies readonly ("active" | RunStatus)[];

type StatusFilter = (typeof STATUSES)[number];

const STATUS_SYNONYMS: Partial<Record<StatusFilter, readonly string[]>> = {
  active: ["running", "in progress", "live", "ongoing", "current", "in flight", "working", "busy", "unfinished", "open"],
  waiting_for_human: ["waiting", "waiting on me", "waiting for input", "needs input", "needing input", "blocked", "paused", "stuck", "awaiting input", "waiting for a person"],
  waiting_for_signal: ["waiting for a signal", "signal"],
  complete: ["completed", "done", "finished", "successful", "succeeded", "passed"],
  failed: ["failing", "broken", "errored", "error", "crashed"],
  cancelled: ["canceled", "stopped", "aborted", "killed"],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** "failed dev-task" → { status: "failed", workflow: "dev-task" }; words that are neither come back as `unknown`. */
async function parseFilter(raw: string, ctx: ToolContext): Promise<{ status?: StatusFilter; workflow?: string; unknown?: string }> {
  let rest = ` ${norm(raw)} `;
  let workflow: string | undefined;
  for (const w of await ctx.world.workflows()) {
    const n = ` ${norm(w.name)} `;
    if (rest.includes(n)) {
      workflow = w.name;
      rest = rest.replace(n, " ");
      break;
    }
  }
  const q = rest.replace(/\b(?:the|all|my|of|workflow|weft)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return { workflow };
  const status = STATUSES.find((v) => norm(v) === q) ?? STATUSES.find((v) => STATUS_SYNONYMS[v]?.some((x) => norm(x) === q));
  return status ? { status, workflow } : { workflow, unknown: q };
}

/** The Runs page's ?status= group for a status filter (components/runs/run-bits.tsx statusGroup). */
function statusGroup(s: StatusFilter): string {
  if (s === "waiting_for_human") return "needs_input";
  if (s === "complete") return "done";
  if (s === "failed" || s === "cancelled") return "failed";
  return "active";
}

/** The run's workflow and id, "dev-task f0626e7d", for summaries. */
async function runName(runId: string, ctx: ToolContext): Promise<string> {
  try {
    const row = (await ctx.world.runs()).find((r) => r.runId === runId);
    return row ? `${row.workflow} ${runId}` : `run ${runId}`;
  } catch {
    return `run ${runId}`;
  }
}

/** The project a run belongs to: from a pending request in the Inbox, else the run's own input. */
async function projectOf(run: RunDetail, ctx: ToolContext): Promise<string | undefined> {
  try {
    const hit = (await ctx.world.inbox()).find((i) => i.kind === "human" && (i.entry.runId === run.runId || i.entry.rootRunId === run.runId));
    if (hit) return hit.projectId;
  } catch {
    // fall back to the input
  }
  const input = run.input as { projectId?: unknown } | null;
  return typeof input?.projectId === "string" ? input.projectId : undefined;
}

const pendingOf = (run: RunDetail) => run.humans.filter((h) => h.status === "pending" && h.kind !== "gate");

/** A phase's status from its steps: failed, running, done, or nothing yet. */
function phaseStatus(nodes: TreeNode[]): { label: string; tone: Tone } {
  const all: StepStatus[] = [];
  const walk = (ns: TreeNode[]) => ns.forEach((n) => (all.push(n.status), walk(n.children)));
  walk(nodes);
  if (!all.length) return { label: "Not reached", tone: "neutral" };
  if (all.includes("failed")) return pill(stepStatusMeta("failed"));
  if (all.includes("running")) return pill(stepStatusMeta("running"));
  return pill(stepStatusMeta("ok"));
}

const FILE_STATUS: Record<FileStat["status"], { label: string; tone: Tone }> = {
  added: { label: "Added", tone: "success" },
  deleted: { label: "Deleted", tone: "danger" },
  modified: { label: "Modified", tone: "running" },
  binary: { label: "Binary", tone: "neutral" },
};

/** Weft runs and workflows: list, inspect, cancel, resume and start them; the mock's skip-ahead. */
export const runsTools = [
  defineTool({
    name: "list_runs",
    group: "runs",
    title: "List runs",
    description: "List weft runs, newest first, optionally filtered by status ('active' means planning, running, integrating or verifying) and by workflow.",
    effect: "read",
    params: {
      status: { kind: "enum", description: "Only runs with this status; 'active' for every run still working", required: false, values: STATUSES, synonyms: STATUS_SYNONYMS },
      workflow: { kind: "workflow", description: "Only runs of this workflow", required: false },
      filter: { kind: "text", description: "Status and workflow in plain words, e.g. 'failed dev-task', when they come together; prefer status and workflow", required: false },
    },
    // "show the runs" stays navigation's (open the Runs page), so "show" takes a status but not free words.
    utterances: [
      "list [all] [the] [recent|latest] runs",
      "show (me|all) [all] [the] [recent|latest] runs",
      "show [the] (recent|latest|newest) runs",
      "(list|show me) [all] [the] {filter} runs",
      "show [all] [the] {status} runs",
      "(list|show [me]) [all] [the] runs (of|for|from) [the] [workflow] {workflow} [workflow]",
      "(list|show [me]) [all] [the] {status} runs (of|for|from) [the] [workflow] {workflow} [workflow]",
      "(list|show [me]) [all] [the] {workflow} workflow runs",
      "(which|what) runs are {status} [right now|at the moment]",
      "(which|what) {workflow} runs are {status} [right now|at the moment]",
      "(are there any|any|how many) {filter} runs",
      "(what|which) runs (are there|do we have|have run)",
    ],
    examples: ["List failed runs", "Which runs are active?", "Show me all runs"],
    covers: ["weft.runs", "weft.workflows"],
    summary: async ({ status, workflow, filter }, ctx) => {
      const f = filter ? await parseFilter(filter, ctx) : {};
      const st = status ?? f.status;
      const wf = workflow ?? f.workflow;
      return `List ${st ? `${st === "active" ? "active" : runStatusMeta(st).label.toLowerCase()} ` : ""}${wf ? `${wf} ` : ""}runs`;
    },
    run: async ({ status: s, workflow: w, filter }, ctx) => {
      const f = filter ? await parseFilter(filter, ctx) : {};
      if (f.unknown) {
        const flows = await ctx.world.workflows();
        return { text: `I don't know “${f.unknown}” as a run status or workflow. Statuses: active, waiting (for input), complete, failed, cancelled. Workflows: ${flows.map((x) => x.name).join(", ")}.` };
      }
      const status = s ?? f.status;
      const workflow = w ?? f.workflow;
      const rows = await weft.runs({ status: status && status !== "active" ? status : undefined, workflow, limit: 200, spend: true });
      const list = (status === "active" ? rows.filter((r) => statusGroup(r.status) === "active") : rows).sort((a, b) => b.createdAt - a.createdAt);
      const what = [status && `status “${status === "active" ? "Active" : runStatusMeta(status).label}”`, workflow && `workflow ${workflow}`].filter(Boolean).join(" and ");
      if (!list.length) return { text: `No runs${what ? ` with ${what}` : ""}.` };
      const shown = list.slice(0, 12);
      const sp = new URLSearchParams();
      if (status) sp.set("status", statusGroup(status));
      if (workflow) sp.set("workflow", workflow);
      const items: ResultItem[] = shown.map((r) => ({
        title: `${r.workflow} · ${r.runId}`,
        subtitle: [r.steps !== undefined && plural(r.steps, "step"), r.running && `${r.running} running`, r.spend && formatUsd(r.spend.usd)].filter(Boolean).join(" · "),
        meta: formatRelative(r.createdAt),
        href: runHref(r.runId),
        status: pill(runStatusMeta(r.status)),
      }));
      return {
        text: `${plural(list.length, "run")}${what ? ` with ${what}` : ""}${list.length > shown.length ? `; here are the newest ${shown.length}` : ""}.`,
        blocks: [{ type: "items", items, ...(list.length > shown.length ? { more: { label: `All ${list.length} on the Runs page`, href: `/runs${sp.toString() ? `?${sp}` : ""}` } } : {}) }],
      };
    },
  }),
  defineTool({
    name: "run_details",
    group: "runs",
    title: "Show a run's details",
    description: "Summarize one weft run: status, workflow, project, timing, spend against its budget, checks, its phases and steps, and any requests waiting on a person.",
    effect: "read",
    params: { runId: { kind: "run", description: "The run id (or a prefix, 'latest' or a workflow name); defaults to the page's run" } },
    utterances: [
      "(details|info|status|summary) (of|for|on) [the] run {runId}",
      "(details|info|status|summary) (of|for|on) [the] {runId} run",
      "(what's|what is|whats) the status of [the] run {runId}",
      "(what's|what is|whats) the status of [the] {runId} run",
      "(how is|how's|hows) [the] run {runId} [doing|going|getting on]",
      "(how is|how's|hows) [the] {runId} run [doing|going|getting on]",
      "(describe|summarize|summarise|inspect|explain) [the] run {runId}",
      "(describe|summarize|summarise|inspect|explain) [the] {runId} run",
      "(describe|summarize|summarise|inspect|explain) (this|the current) run",
      "run {runId} (details|status|info|summary)",
    ],
    examples: ["How is the latest run doing?", "Summarize this run"],
    covers: ["weft.run", "weft.tree"],
    summary: async ({ runId }, ctx) => `Summarize ${await runName(runId, ctx)}`,
    run: async ({ runId }, ctx) => {
      const [run, tree] = await Promise.all([weft.run(runId), weft.tree(runId)]);
      const status = runStatusMeta(run.status);
      const terminal = isTerminal(run.status);
      const pending = pendingOf(run);
      const running = run.steps.filter((s) => s.status === "running").length;
      const projectId = await projectOf(run, ctx);
      const checksPassed = run.checks.filter((c) => c.status === "pass").length;
      const took = formatDuration((terminal ? run.updatedAt : Date.now()) - run.createdAt);

      const facts: Array<{ label: string; value: string; href?: string }> = [
        { label: "Status", value: status.label },
        { label: "Workflow", value: run.workflow, href: `/runs?workflow=${enc(run.workflow)}` },
      ];
      if (projectId) facts.push({ label: "Project", value: await ctx.world.projectName(projectId), href: `/projects/${enc(projectId)}` });
      facts.push(
        { label: "Started", value: formatDateTime(run.createdAt, { seconds: false }) },
        { label: terminal ? "Took" : "Running for", value: took },
        { label: "Steps", value: `${run.steps.length}${running ? ` (${running} running)` : ""}` },
        { label: "Spend", value: `${formatUsd(run.budget.usd)} · ${formatTokens(run.budget.tokens)}${run.limits?.usd ? ` of ${formatUsd(run.limits.usd)}` : ""}` },
      );
      if (run.checks.length) facts.push({ label: "Checks", value: `${checksPassed} of ${run.checks.length} passed` });
      if (run.parentRunId) facts.push({ label: "Started by", value: `run ${run.parentRunId}`, href: runHref(run.parentRunId) });

      const blocks: ResultBlock[] = [{ type: "facts", facts }];
      if (run.error) blocks.push({ type: "text", tone: "danger", text: `${run.error.code}: ${run.error.message}` });
      if (pending.length)
        blocks.push({
          type: "items",
          title: "Waiting for a person",
          items: pending.map((h) => ({ title: firstLine(h.question), subtitle: [h.phase, h.key].filter(Boolean).join(" · ") || undefined, meta: formatRelative(h.requestedAt), href: runHref(runId, "requests"), status: pill(humanKindMeta(h.kind)) })),
        });
      if (tree.length)
        blocks.push({
          type: "items",
          title: "Phases",
          items: tree.map((p) => ({ title: p.name, subtitle: clip(p.nodes.map((n) => n.label).join(", ")) || undefined, meta: plural(p.nodes.length, "step"), status: phaseStatus(p.nodes), href: runHref(runId) })),
        });
      blocks.push({
        type: "links",
        links: [
          { label: "Open the run", href: runHref(runId) },
          { label: "Report", href: runHref(runId, "report") },
          ...(run.patches.captured.length ? [{ label: "Changes", href: runHref(runId, "changes") }] : []),
        ],
      });

      const name = `${run.workflow} ${runId}`;
      const text =
        run.status === "waiting_for_human"
          ? `${name} is waiting on you: ${plural(pending.length, "request")}. Say “answer the request of run ${runId}” to answer it here.`
          : run.status === "complete"
            ? `${name} completed in ${took}, spending ${formatUsd(run.budget.usd)}.`
            : run.status === "failed"
              ? `${name} failed after ${took}${run.error ? `: ${run.error.message}` : "."} You can resume it.`
              : run.status === "cancelled"
                ? `${name} was cancelled. You can resume it.`
                : `${name} is ${status.label.toLowerCase()} (${took} so far, ${plural(run.steps.length, "step")}).`;
      return { text, blocks };
    },
  }),
  defineTool({
    name: "run_report",
    group: "runs",
    title: "Show a run's report",
    description: "Show the markdown report weft writes for a run: status, cost, changes, checks and their evidence, notes.",
    effect: "read",
    params: { runId: { kind: "run", description: "The run; defaults to the page's run" } },
    utterances: [
      "(show|get|read|open|give) [me] [the] [run] report",
      "(show|get|read|open|give) [me] [the] [run] report (of|for|from|on) [the] [run] {runId} [run]",
      "(show|get|read|open) [me] [the] {runId} run's report",
      "(what's|what is|whats) in the report (of|for) [the] [run] {runId} [run]",
      "run report [for|of] [the] [run] {runId} [run]",
    ],
    examples: ["Show the report for the latest run"],
    covers: ["weft.report"],
    summary: async ({ runId }, ctx) => `Show the report of ${await runName(runId, ctx)}`,
    run: async ({ runId }, ctx) => {
      const md = await weft.report(runId);
      const MAX = 4000;
      const cut = md.length > MAX ? md.lastIndexOf("\n", MAX) : -1;
      const text = md.length > MAX ? `${md.slice(0, cut > MAX / 2 ? cut : MAX)}\n\n…` : md;
      return {
        text: `Here's the report of ${await runName(runId, ctx)}${md.length > MAX ? "; it's long, so the rest is on the run's Report tab" : ""}.`,
        blocks: [{ type: "markdown", title: "Run report", text, href: runHref(runId, "report") }],
      };
    },
  }),
  defineTool({
    name: "run_artifacts",
    group: "runs",
    title: "List a run's artifacts",
    description: "List what a run produced: captured patches and the documents attached to its reviews and approvals.",
    effect: "read",
    params: { runId: { kind: "run", description: "The run; defaults to the page's run" } },
    utterances: [
      "(list|show [me]|get) [the] [run] artifacts",
      "(list|show [me]|get) [the] artifacts (of|for|from) [the] [run] {runId} [run]",
      "(list|show [me]|get) [the] {runId} run's artifacts",
      "what did [the] [run] {runId} [run] (produce|output|generate|create)",
      "(what|which) artifacts did [the] [run] {runId} [run] (produce|create|make)",
    ],
    examples: ["List the artifacts of the latest run", "What did the latest run produce?"],
    covers: ["weft.artifacts"],
    summary: async ({ runId }, ctx) => `List the artifacts of ${await runName(runId, ctx)}`,
    run: async ({ runId }, ctx) => {
      const list = await weft.artifacts(runId);
      const name = await runName(runId, ctx);
      if (!list.length) return { text: `${name} hasn't produced any artifacts yet.` };
      const items: ResultItem[] = list.slice(0, 15).map((a) => ({
        title: a.kind === "patch" ? `Patch ${a.key ?? a.id}` : a.gate ? `${a.id} · ${humanKindMeta(a.gate.kind as Parameters<typeof humanKindMeta>[0]).label.toLowerCase()} attachment` : a.id,
        subtitle: a.kind === "patch" ? plural(a.files?.length ?? 0, "file") : a.preview ? firstLine(a.preview) : a.producedBy?.label,
        meta: a.size !== null ? formatBytes(a.size) : undefined,
        href: runHref(runId, "artifacts"),
        ...(a.available ? {} : { status: { label: "Unavailable", tone: "neutral" as const } }),
      }));
      const patches = list.filter((a) => a.kind === "patch").length;
      return {
        text: `${name} produced ${plural(list.length, "artifact")}${patches ? `, ${plural(patches, "patch", "patches")} among them` : ""}.`,
        blocks: [{ type: "items", items, ...(list.length > items.length ? { more: { label: `All ${list.length} on the Artifacts tab`, href: runHref(runId, "artifacts") } } : {}) }],
      };
    },
  }),
  defineTool({
    name: "run_changes",
    group: "runs",
    title: "Show a run's code changes",
    description: "Show the files a run's patches changed, with lines added and removed, and whether each patch was merged.",
    effect: "read",
    params: { runId: { kind: "run", description: "The run; defaults to the page's run" } },
    utterances: [
      "(show|list) [me] [the] (changes|diff|diffs|patch|patches|changed files|file changes) (of|for|from|in|on|made by) [the] [run] {runId} [run]",
      "(show|list) [me] [the] run's (changes|diff|patch|changed files)",
      "(show|list) [me] [the] run (changes|diff|patch|changed files)",
      "(what|which) files did [the] [run] {runId} [run] (change|touch|modify|edit)",
      "what did [the] [run] {runId} [run] change",
      "how many (lines|files) did [the] [run] {runId} [run] change",
    ],
    examples: ["What files did the latest run change?"],
    covers: ["weft.patch"],
    summary: async ({ runId }, ctx) => `Show the changes of ${await runName(runId, ctx)}`,
    run: async ({ runId }, ctx) => {
      const { patches } = await weft.patch(runId, { statsOnly: true });
      const name = await runName(runId, ctx);
      if (!patches.length) return { text: `${name} hasn't captured any code changes.` };
      const files = patches.flatMap((p) => p.stats);
      const adds = files.reduce((n, f) => n + f.adds, 0);
      const dels = files.reduce((n, f) => n + f.dels, 0);
      const blocks: ResultBlock[] = patches.slice(0, 4).map((p) => ({
        type: "items",
        title: `${p.key} · ${p.merged ? "merged" : p.discarded ? "discarded" : "not merged yet"}`,
        items: p.stats.slice(0, 12).map((f) => ({ title: f.path, meta: `+${f.adds} −${f.dels}`, status: FILE_STATUS[f.status] ?? { label: f.status, tone: "neutral" }, href: runHref(runId, "changes") })),
        ...(p.stats.length > 12 ? { more: { label: `All ${p.stats.length} files on the Changes tab`, href: runHref(runId, "changes") } } : {}),
      }));
      const outOfScope = patches.flatMap((p) => p.outOfScope);
      if (outOfScope.length) blocks.push({ type: "text", tone: "attention", text: `${plural(outOfScope.length, "file")} changed outside the task's scope: ${clip(outOfScope.join(", "), 200)}` });
      return { text: `${name} changed ${plural(files.length, "file")} (+${adds} −${dels}) in ${plural(patches.length, "patch", "patches")}.`, blocks };
    },
  }),
  defineTool({
    name: "cancel_run",
    group: "runs",
    title: "Cancel a run",
    description: "Stop a run where it is: open requests are withdrawn and nothing more is spent. It can be resumed later.",
    effect: "destructive",
    params: { runId: { kind: "run", description: "The run to cancel; defaults to the page's run" } },
    utterances: [
      "(cancel|stop|abort|kill|halt|terminate) [the] run {runId}",
      "(cancel|stop|abort|kill|halt|terminate) [the] {runId} run",
      "(cancel|stop|abort|kill|halt|terminate) [the|this] run",
    ],
    examples: ["Cancel this run", "Stop the latest run"],
    covers: ["weft.cancel"],
    summary: async ({ runId }, ctx) => `Cancel ${await runName(runId, ctx)}`,
    preview: async ({ runId }) => {
      const run = await weft.run(runId);
      if (isTerminal(run.status)) return [{ type: "text", tone: "attention", text: `This run is already ${statusWords(run.status)}; there is nothing to cancel.` }];
      const pending = pendingOf(run).length;
      return [
        { type: "text", text: `${run.workflow} stops where it is. Open requests are withdrawn and nothing more is spent. You can resume it later.` },
        ...(pending ? [{ type: "text" as const, tone: "attention" as const, text: `${plural(pending, "pending request")} will be withdrawn.` }] : []),
      ];
    },
    run: async ({ runId }, ctx) => {
      const run = await weft.run(runId);
      if (isTerminal(run.status)) throw new Error(`Run ${runId} is already ${statusWords(run.status)}; there is nothing to cancel.`);
      await weft.cancel(runId);
      ctx.invalidate(await projectOf(run, ctx));
      return { text: `Run cancelled: ${run.workflow} ${runId} stopped where it was. You can resume it from its page.`, blocks: [{ type: "links", links: [{ label: "Open the run", href: runHref(runId) }] }] };
    },
  }),
  defineTool({
    name: "resume_run",
    group: "runs",
    title: "Resume a run",
    description: "Resume a failed or cancelled run: weft replays its journal and continues from the last completed step, retrying a failed one. Spend continues against the same budget.",
    effect: "write",
    params: { runId: { kind: "run", description: "The run to resume; defaults to the page's run" } },
    utterances: [
      "(resume|restart|retry|continue|rerun|re-run|revive) [the] run {runId}",
      "(resume|restart|retry|continue|rerun|re-run|revive) [the] {runId} run",
      "(resume|restart|retry|continue|rerun|re-run) [the|this] run",
    ],
    examples: ["Resume this run", "Retry the latest run"],
    covers: ["weft.resume"],
    summary: async ({ runId }, ctx) => `Resume ${await runName(runId, ctx)}`,
    preview: async ({ runId }) => {
      const run = await weft.run(runId);
      if (run.status !== "failed" && run.status !== "cancelled") return [{ type: "text", tone: "attention", text: `Only a failed or cancelled run can be resumed; this one is ${statusWords(run.status)}.` }];
      return [{ type: "text", text: `weft replays the journal of ${run.workflow} and continues from the last completed step${run.status === "failed" ? ", retrying the step that failed" : ""}. Spend continues against the same budget.` }];
    },
    run: async ({ runId }, ctx) => {
      const run = await weft.run(runId);
      if (run.status !== "failed" && run.status !== "cancelled") throw new Error(`Only a failed or cancelled run can be resumed; ${runId} is ${statusWords(run.status)}.`);
      await weft.resume(runId);
      ctx.invalidate(await projectOf(run, ctx));
      return { text: `Run resumed: ${run.workflow} ${runId} continues from its last completed step.`, blocks: [{ type: "links", links: [{ label: "Open the run", href: runHref(runId) }] }] };
    },
  }),
  defineTool({
    name: "list_workflows",
    group: "runs",
    title: "List workflows",
    description: "List the weft workflows this app runs, the stage each belongs to, and whether it is a real po-workspace workflow or a mock shaped like one.",
    effect: "read",
    params: {},
    utterances: [
      "(list|show [me]) [all] [the] [available] workflows",
      "(what|which) workflows (are there|do we have|exist|are available|can i run|can you run)",
      "(what|which) workflows",
    ],
    examples: ["Which workflows are there?", "List the workflows"],
    covers: ["weft.workflows"],
    summary: () => "List workflows",
    run: async (_input, ctx) => {
      const flows = await ctx.world.workflows();
      const items: ResultItem[] = flows.map((w) => {
        const stage = STAGES.find((s) => s.workflows.includes(w.name));
        return {
          title: w.name,
          subtitle: w.description,
          meta: stage ? `Stage ${stage.n} · ${stage.title}` : undefined,
          href: `/runs?workflow=${enc(w.name)}`,
          status: REAL_WORKFLOWS.has(w.name) ? { label: "Real weft workflow", tone: "success" } : { label: "Mocked", tone: "neutral" },
        };
      });
      return { text: `${plural(flows.length, "workflow")}: ${flows.map((w) => w.name).join(", ")}.`, blocks: [{ type: "items", items }] };
    },
  }),
  defineTool({
    name: "workflow_details",
    group: "runs",
    title: "Describe a workflow",
    description: "Describe one weft workflow: what it does, its stage, default model, and the input fields it takes.",
    effect: "read",
    params: { workflow: { kind: "workflow", description: "The workflow name, e.g. po-brd" } },
    utterances: [
      "(describe|explain) [the] {workflow} workflow",
      "(describe|explain) [the] workflow {workflow}",
      "(what does|what's|what is|whats) [the] {workflow} workflow [do|for]",
      "what does [the] {workflow} do",
      "how does [the] {workflow} workflow work",
      "(show|get) [me] [the] {workflow} workflow (details|info|input|inputs|schema)",
      "(details|info|inputs|input) (of|for|on|about) [the] [workflow] {workflow} [workflow]",
      "(what|which) (input|inputs|fields) does [the] {workflow} [workflow] (take|need|expect)",
    ],
    examples: ["What does the po-brd workflow do?"],
    covers: ["weft.workflow"],
    summary: ({ workflow }) => `Describe the ${workflow} workflow`,
    run: async ({ workflow }) => {
      const w = await weft.workflow(workflow);
      const stage = STAGES.find((s) => s.workflows.includes(w.name));
      const facts = [
        { label: "Workflow", value: w.name },
        { label: "Kind", value: REAL_WORKFLOWS.has(w.name) ? "Real po-workspace workflow" : "Mock shaped like a weft workflow" },
        ...(stage ? [{ label: "Stage", value: `${stage.n} · ${stage.title}` }] : []),
        { label: "File", value: w.file },
        ...(w.defaults?.model ? [{ label: "Default model", value: [w.defaults.provider, w.defaults.model, w.defaults.effort].filter(Boolean).join(" · ") }] : []),
      ];
      const props = (w.input?.properties ?? {}) as Record<string, { type?: unknown; description?: unknown; default?: unknown }>;
      const required = new Set(Array.isArray(w.input?.required) ? (w.input.required as string[]) : []);
      const fields: ResultItem[] = Object.entries(props).map(([key, p]) => ({
        title: key,
        subtitle: typeof p.description === "string" ? p.description : undefined,
        meta: [typeof p.type === "string" ? p.type : undefined, required.has(key) ? "required" : p.default !== undefined ? `default ${clip(JSON.stringify(p.default), 30)}` : undefined].filter(Boolean).join(" · "),
      }));
      const blocks: ResultBlock[] = [{ type: "facts", facts }];
      if (fields.length) blocks.push({ type: "items", title: "Input", items: fields.slice(0, 14) });
      if (w.schemaWarnings.length) blocks.push({ type: "text", tone: "attention", text: w.schemaWarnings.join(" ") });
      blocks.push({ type: "links", links: [{ label: `Runs of ${w.name}`, href: `/runs?workflow=${enc(w.name)}` }] });
      return { text: `${w.name}: ${w.description}`, blocks };
    },
  }),
  defineTool({
    name: "start_workflow",
    group: "runs",
    title: "Start a workflow run",
    description:
      "Start a weft run of any workflow with an optional JSON input, outside any project. Stage runs (a project's BRD, AAD, plan, tasks, QA) should be started with their stage tools instead, which link the run to the project.",
    effect: "write",
    params: {
      workflow: { kind: "workflow", description: "The workflow to run, e.g. po-brd" },
      input: { kind: "json", description: 'The run input as a JSON object, e.g. {"request": "…"}', required: false },
    },
    utterances: [
      "(start|launch|kick off|trigger) [a new|another|a|the] {workflow} [workflow|run]",
      "(start|launch|kick off|trigger) [a new|another|a|the] {workflow} [workflow|run] with [input] {input}",
      "(start|launch|kick off|trigger|create) [a] [new] run of [the] [workflow] {workflow} [workflow]",
      "(start|launch|kick off|trigger|create) [a] [new] run of [the] [workflow] {workflow} [workflow] with [input] {input}",
      "run [the] workflow {workflow} [with [input] {input}]",
    ],
    examples: ["Start a new po-brd run", 'Start a po-brd run with {"request": "Reorder reminders"}'],
    covers: ["weft.start", "weft.workflow"],
    summary: ({ workflow, input }) => `Start a ${workflow} run${input ? ` with ${plural(Object.keys(input).length, "input field")}` : ""}`,
    preview: async ({ workflow, input }) => {
      const w = await weft.workflow(workflow);
      const required = Array.isArray(w.input?.required) ? (w.input.required as string[]) : [];
      const missing = required.filter((k) => !(input && k in input));
      const stage = STAGES.find((s) => s.workflows.includes(w.name));
      return [
        ...(stage ? [{ type: "text" as const, text: `${w.name} is the ${stage.title} workflow. Started here, the run belongs to no project; a project's stage page starts it with the project's documents and links the result.` }] : []),
        ...(missing.length ? [{ type: "text" as const, tone: "attention" as const, text: `${w.name} expects ${missing.join(", ")} in its input; without ${missing.length === 1 ? "it" : "them"} the run will not start.` }] : []),
      ];
    },
    run: async ({ workflow, input }, ctx) => {
      const res = await weft.start({ workflow, ...(input ? { input } : {}) });
      ctx.invalidate();
      return { text: `Started a ${res.workflow} run: ${res.runId}.`, blocks: [{ type: "links", links: [{ label: `Open run ${res.runId}`, href: runHref(res.runId) }] }] };
    },
  }),
  defineTool({
    name: "engine_info",
    group: "runs",
    title: "Show the weft engine's info",
    description: "Show which weft engine serves /api/weft (the built-in mock or a daemon), its version, repository, default model, limits and approval policy.",
    effect: "read",
    params: {},
    utterances: [
      "(what|which) version of weft [is (this|running|it)|are we (on|running|using)]",
      "(what|which) weft version [is (this|running|it)|are we (on|running|using)]",
      "(show|get|give) [me] [the] (weft|engine) (version|info|details|meta|metadata|limits|config)",
      "(weft|engine) (version|info|details|limits)",
      "(what|which) (engine|backend) (is this|are we using|is running|runs the agents)",
      "(what|which) model do [the] (agents|runs|workflows) use",
    ],
    examples: ["Which version of weft is this?", "Show the engine info"],
    covers: ["weft.meta", "delivery.settings"],
    summary: () => "Show the weft engine's info",
    run: async (_input, ctx) => {
      const [meta, settings] = await Promise.all([weft.meta(), ctx.world.settings()]);
      const tiers = Object.entries(meta.approvalPolicy.tiers ?? {})
        .map(([risk, mode]) => `${risk} ${mode}`)
        .join(", ");
      const source = settings.dataSource === "weft" ? `weft daemon at ${settings.weftDaemon}` : "Built-in mock";
      const facts = [
        { label: "Engine", value: `weft ${meta.version}` },
        { label: "Data source", value: source, href: "/settings" },
        { label: "Repository", value: `${meta.repo.name} (${meta.repo.cwd})` },
        { label: "Default model", value: [meta.defaults.provider, meta.defaults.model, meta.defaults.effort].filter(Boolean).join(" · ") },
        { label: "Concurrency", value: `${meta.limits.concurrency} steps` },
        { label: "Limits", value: `${meta.limits.maxTurns} turns, depth ${meta.limits.maxDepth}, ${formatDuration(meta.limits.stepTimeoutMs)} per step` },
        ...(tiers ? [{ label: "Approval policy", value: tiers }] : []),
        { label: "Providers", value: meta.providers.map((p) => `${p.id}${p.registered ? "" : " (not registered)"}`).join(", ") || "None" },
      ];
      return { text: `/api/weft is served by the ${settings.dataSource === "weft" ? "weft daemon" : "built-in mock"}, weft ${meta.version}, on ${meta.repo.name}.`, blocks: [{ type: "facts", facts }] };
    },
  }),
  defineTool({
    name: "fast_forward",
    group: "runs",
    title: "Skip ahead to the next human step",
    description:
      "Demo only: make the built-in mock's running agents finish their simulated work now and stop at their next question, review or approval, instead of waiting out the demo speed. Runs already waiting on a person are left alone. Optionally just one run.",
    effect: "write",
    params: { runId: { kind: "run", description: "Only this run; every running agent when left out", required: false, fromPage: false } },
    utterances: [
      "(skip ahead|skip forward|fast forward|fast-forward|fastforward)",
      "(skip ahead|skip forward|fast forward|fast-forward|fastforward) (all|everything|all runs|the runs|all agents|the agents|the demo)",
      "(skip ahead|skip forward|fast forward|fast-forward|fastforward) [the] run {runId}",
      "(skip ahead|skip forward|fast forward|fast-forward|fastforward) [the] {runId} run",
      "skip to the next (human step|question|request|review|approval)",
      "(finish|complete) [the] (simulated|mock) (work|steps) [now]",
    ],
    examples: ["Skip ahead", "Fast-forward this run"],
    covers: ["delivery.fastForward", "delivery.settings"],
    summary: async ({ runId }, ctx) => (runId ? `Skip ${await runName(runId, ctx)} ahead to its next human step` : "Skip every running agent ahead to its next human step"),
    preview: async (_input, ctx) => {
      const s = await ctx.world.settings();
      return [
        { type: "text", text: "Running agents finish their simulated work now and stop at their next question, review or approval. Runs already waiting on a person are left alone." },
        ...(s.dataSource === "weft" ? [{ type: "text" as const, tone: "attention" as const, text: "This only drives the built-in mock; runs served by the weft daemon are not affected." }] : []),
      ];
    },
    // No refresh, like the Settings button: live events move the pages along.
    run: async ({ runId }) => {
      await delivery.fastForward(runId);
      return { text: runId ? `Skipped ahead: run ${runId} moves on to its next human step.` : "Skipped ahead: running agents moved on to their next human step." };
    },
  }),
] as const;
