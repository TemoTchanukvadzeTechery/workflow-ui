import { delivery } from "@/lib/api/client";
import type { DeliveryTask, DeliveryTaskStatus, ProjectBundle, TaskPatchBody, TaskStartBody } from "@/lib/delivery/types";
import { plural } from "@/lib/format";
import { epicStatusMeta, qaStatusMeta, runStatusMeta, taskStatusMeta } from "@/lib/weft/labels";
import { defineTool } from "../define";
import type { ResultBlock, ResultItem, ToolContext } from "../types";
import { clip, href, pill, taskTitle } from "./projects";

/** Agents that may run at once (the orchestrator's limit, as on the task board). */
const AGENT_LIMIT = 3;

const TASK_STATUSES = ["proposed", "ready", "in_progress", "verifying", "in_review", "changes_requested", "done", "blocked", "cancelled"] as const satisfies readonly DeliveryTaskStatus[];

/** "T-4 (CP-52337)": the board's id first, the Jira key alongside once the epics are synced. */
const boardLabel = (t: Pick<DeliveryTask, "id" | "jiraKey">) => (t.jiraKey ? `${t.id} (${t.jiraKey})` : t.id);
const taskName = (t: DeliveryTask) => `${t.id} · ${taskTitle(t.title)}`;

function taskItem(projectId: string, t: DeliveryTask): ResultItem {
  return {
    title: taskName(t),
    subtitle: [t.jiraKey, `wave ${t.wave}`, t.repo, t.blockedBy ? `blocked: ${t.blockedBy}` : t.latestStep].filter(Boolean).join(" · "),
    meta: `${t.size} · ${t.priority}`,
    href: href.task(projectId, t.id),
    status: pill(taskStatusMeta(t.status)),
  };
}

const unmetDeps = (t: DeliveryTask, tasks: readonly DeliveryTask[]) =>
  t.dependencies.filter((d) => {
    const dep = tasks.find((x) => x.id === d);
    return dep && dep.status !== "done" && dep.status !== "cancelled";
  });

/** Why ready tasks did not start right away, in the ids the board shows (the task board's queue reason). */
function queueReason(targets: readonly DeliveryTask[], tasks: readonly DeliveryTask[]): string {
  const waiting = targets.map((t) => ({ t, deps: unmetDeps(t, tasks) })).filter((x) => x.deps.length > 0);
  if (waiting.length > 0) {
    const first = waiting[0]!;
    const rest = waiting.length > 1 ? ` (+${waiting.length - 1} more waiting on dependencies)` : "";
    return `${boardLabel(first.t)} waits for ${first.deps.join(", ")}${rest}. It starts on its own once ${first.deps.length === 1 ? "that is" : "they are"} approved.`;
  }
  const busy = tasks.filter((t) => t.status === "in_progress" || t.status === "verifying" || t.status === "changes_requested").length;
  if (busy >= AGENT_LIMIT) return `${busy} agents are already working (limit ${AGENT_LIMIT}). Queued tasks start as soon as one finishes.`;
  return "They are queued and start as soon as an agent slot is free.";
}

/** The tasks a start request picks, as the server does: the named one, a wave's ready tasks, or every ready task. */
function startTargets(b: ProjectBundle, wave?: number, taskId?: string): DeliveryTask[] {
  if (taskId) return b.tasks.filter((t) => t.id === taskId && t.status === "ready");
  return b.tasks.filter((t) => t.status === "ready" && (wave === undefined || t.wave === wave));
}

async function taskLabel(projectId: string, taskId: string, ctx: ToolContext): Promise<string> {
  const t = (await ctx.world.project(projectId)).tasks.find((x) => x.id === taskId);
  return t ? taskName(t) : taskId;
}

/** Tasks: the board, one task, starting waves or tasks, editing a task, retrying one. */
export const tasksTools = [
  defineTool({
    name: "list_tasks",
    group: "tasks",
    title: "List tasks",
    description: "List a project's implementation tasks with status, wave, repo, size and priority, optionally only those with one status.",
    effect: "read",
    params: {
      projectId: { kind: "project", description: "The project" },
      status: {
        kind: "enum",
        description: "Only tasks with this status",
        values: TASK_STATUSES,
        synonyms: {
          in_progress: ["running", "active", "in flight", "ongoing", "started", "working"],
          in_review: ["review", "awaiting review", "to review", "waiting for review", "reviewable"],
          changes_requested: ["rework", "reworking", "sent back"],
          done: ["finished", "complete", "completed", "approved"],
          blocked: ["stuck", "on hold"],
          proposed: ["planned"],
          verifying: ["checking"],
          cancelled: ["canceled", "dropped"],
        },
        required: false,
      },
    },
    utterances: [
      "(show|list|see|view) [me] [all] [the] tasks (for|of|in|on) [the] [project] {projectId}",
      "(show|list|see|view) [me] [all] [the] tasks",
      "(show|list|see|view) [me] [all] [the] {status} tasks (for|of|in|on) [the] [project] {projectId}",
      "(show|list|see|view) [me] [all] [the] {status} tasks",
      "(which|what) tasks are {status}",
      "(which|what) tasks are {status} (for|of|in|on) [the] [project] {projectId}",
      "(show|what's on|whats on) [the] task board [for|of|in] [the] [project] {projectId}",
    ],
    examples: ["Show the tasks for {project}", "Which tasks are in review?", "List the blocked tasks"],
    covers: ["delivery.project"],
    summary: async ({ projectId, status }, ctx) => `List the ${status ? `${taskStatusMeta(status).label.toLowerCase()} ` : ""}tasks of ${await ctx.world.projectName(projectId)}`,
    run: async ({ projectId, status }, ctx) => {
      const b = await ctx.world.project(projectId);
      const tasks = status ? b.tasks.filter((t) => t.status === status) : b.tasks;
      const label = status ? `${taskStatusMeta(status).label.toLowerCase()} ` : "";
      const done = b.tasks.filter((t) => t.status === "done").length;
      return {
        text: !b.tasks.length
          ? `${b.project.name} has no tasks yet; the implementation plan proposes them.`
          : status
            ? `${b.project.name} has ${plural(tasks.length, `${label}task`)}.`
            : `${b.project.name} has ${plural(b.tasks.length, "task")}, ${done} done.`,
        blocks: [
          {
            type: "items",
            items: [...tasks].sort((x, y) => x.wave - y.wave).map((t) => taskItem(projectId, t)),
            empty: status ? `No ${label}tasks.` : "No tasks yet.",
            more: { label: "Open Implementation", href: href.stage(projectId, "implementation") },
          },
        ],
      };
    },
  }),
  defineTool({
    name: "task_details",
    group: "tasks",
    title: "Show a task",
    description: "One task in detail: status, QA status, wave, size, priority, repo and branch, epic, dependencies, acceptance criteria, checks and its latest run.",
    effect: "read",
    params: {
      projectId: { kind: "project", description: "The project" },
      taskId: { kind: "task", description: "The task, by id (T-3), Jira key or title" },
    },
    utterances: [
      "(show|describe|explain|open) [me] [the] task {taskId}",
      "(show|describe|explain|open) [me] [the] task {taskId} (in|of|for|on) [the] [project] {projectId}",
      "(tell me about|details (of|for|on)) [the] task {taskId}",
      "(what's|what is|whats) the (status|state) of task {taskId}",
      "(how is|how's|hows) task {taskId} (doing|going)",
      "task {taskId} (details|status)",
    ],
    examples: ["Show task T-1", "How is task T-2 going?"],
    covers: ["delivery.project"],
    summary: async ({ projectId, taskId }, ctx) => `Show ${await taskLabel(projectId, taskId, ctx)}`,
    run: async ({ projectId, taskId }, ctx) => {
      const b = await ctx.world.project(projectId);
      const t = b.tasks.find((x) => x.id === taskId);
      if (!t) throw new Error(`${b.project.name} has no task ${taskId}.`);
      const epic = b.epics.find((e) => e.id === t.epicId);
      const runId = t.runIds.at(-1);
      const run = runId ? b.stages.implementation.runs.find((r) => r.runId === runId) : undefined;
      const checks = t.checks.length ? `${t.checks.filter((c) => c.status === "pass").length}/${t.checks.length} passed` : undefined;
      const met = t.acceptanceCriteria.filter((ac) => ac.met).length;
      const facts = [
        { label: "Status", value: taskStatusMeta(t.status).label + (t.blockedBy ? `: ${t.blockedBy}` : "") },
        { label: "QA", value: qaStatusMeta(t.qa.status).label },
        { label: "Wave · size · priority", value: `${t.wave} · ${t.size} · ${t.priority}` },
        { label: "Repo", value: t.repo },
        { label: "Branch", value: t.branch },
        ...(t.jiraKey ? [{ label: "Jira", value: t.jiraKey }] : []),
        ...(epic ? [{ label: "Epic", value: `${epic.key ?? epic.id} · ${epic.title} (${epicStatusMeta(epic.status).label})` }] : []),
        ...(t.dependencies.length ? [{ label: "Depends on", value: t.dependencies.join(", ") }] : []),
        ...(t.traces.length ? [{ label: "Traces", value: t.traces.join(", ") }] : []),
        ...(checks ? [{ label: "Checks", value: checks }] : []),
        ...(t.diffStats ? [{ label: "Diff", value: `+${t.diffStats.adds} −${t.diffStats.dels} in ${plural(t.diffStats.files, "file")}` }] : []),
        ...(t.reworkCount ? [{ label: "Rework", value: `${t.reworkCount}${t.escalated ? " (escalated)" : ""}` }] : []),
        ...(t.lastFeedback ? [{ label: "Last feedback", value: clip(t.lastFeedback, 200) }] : []),
        ...(runId ? [{ label: "Latest run", value: run ? `${runId} · ${runStatusMeta(run.status).label}` : runId, href: href.run(runId) }] : []),
      ];
      const blocks: ResultBlock[] = [
        { type: "facts", title: taskName(t), facts },
        {
          type: "items",
          title: `Acceptance criteria (${met}/${t.acceptanceCriteria.length} met)`,
          items: t.acceptanceCriteria.map((ac) => ({ title: `${ac.id} · ${ac.text}`, status: ac.met ? { label: "Met", tone: "success" } : { label: "Not met", tone: "neutral" } })),
          empty: "No acceptance criteria.",
        },
        { type: "links", links: [{ label: "Open the task", href: href.task(projectId, t.id) }] },
      ];
      return { text: `${boardLabel(t)} is ${taskStatusMeta(t.status).label.toLowerCase()}${t.latestStep ? ` (${t.latestStep})` : ""}; QA: ${qaStatusMeta(t.qa.status).label.toLowerCase()}.`, blocks };
    },
  }),
  defineTool({
    name: "start_tasks",
    group: "tasks",
    title: "Start tasks",
    description:
      "Start ready implementation tasks: every ready task, one wave's, or a single task. Tasks whose dependencies are not done, or beyond the 3-agent limit, are queued and start on their own.",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      wave: { kind: "number", description: "Only this wave", required: false },
      taskId: { kind: "task", description: "Only this task", required: false },
    },
    utterances: [
      "(start|run|kick off|launch|begin) [all] [the] [ready] tasks",
      "(start|run|kick off|launch|begin) [all] [the] [ready] tasks (for|of|in|on) [the] [project] {projectId}",
      "(start|run|kick off|launch|begin) [the] [ready] tasks (in|of|for) wave {wave}",
      "(start|run|kick off|launch|begin) wave {wave} [tasks]",
      "(start|run|kick off|launch|begin) wave {wave} [tasks] (for|of|in|on) [the] [project] {projectId}",
      "(start|run|kick off|launch|begin) [the] (first|next) wave",
      "(start|run|kick off|launch|begin) [work on] [the] task {taskId}",
      "(start|run|kick off|launch|begin) [work on] [the] task {taskId} (for|of|in|on) [the] [project] {projectId}",
    ],
    examples: ["Start the ready tasks for {project}", "Start wave 2", "Start task T-3"],
    covers: ["delivery.startTasks"],
    summary: async ({ projectId, wave, taskId }, ctx) => {
      const name = await ctx.world.projectName(projectId);
      if (taskId) return `Start ${await taskLabel(projectId, taskId, ctx)} in ${name}`;
      return wave !== undefined ? `Start the ready tasks of wave ${wave} in ${name}` : `Start the ready tasks in ${name}`;
    },
    preview: async ({ projectId, wave, taskId }, ctx) => {
      const b = await ctx.world.project(projectId);
      const targets = startTargets(b, wave, taskId);
      if (!targets.length) return [{ type: "text", tone: "attention", text: taskId ? "That task isn't ready, so it can't start." : `There are no ready tasks${wave !== undefined ? ` in wave ${wave}` : ""}.` }];
      return [{ type: "items", title: `${plural(targets.length, "ready task")}`, items: targets.map((t) => taskItem(projectId, t)) }];
    },
    run: async ({ projectId, wave, taskId }, ctx) => {
      const b = await ctx.world.project(projectId);
      const targets = startTargets(b, wave, taskId);
      const body: TaskStartBody = taskId ? { taskIds: [taskId] } : wave !== undefined ? { wave } : {};
      const { runIds } = await delivery.startTasks(projectId, body);
      ctx.invalidate(projectId);
      // As the task board words it: runIds is empty when the tasks were only queued.
      const n = runIds.length;
      const queued = Math.max(0, targets.length - n);
      const text =
        n > 0 && queued === 0
          ? `${plural(n, "agent run")} started.`
          : n > 0
            ? `${plural(n, "agent run")} started, ${queued} queued. ${queueReason(targets, b.tasks)}`
            : `${plural(targets.length || 1, "task")} queued. ${queueReason(targets, b.tasks)}`;
      return {
        text,
        blocks: [{ type: "links", links: [...runIds.map((r) => ({ label: `Run ${r}`, href: href.run(r) })), { label: "Open Implementation", href: href.stage(projectId, "implementation") }] }],
      };
    },
  }),
  defineTool({
    name: "update_task",
    group: "tasks",
    title: "Edit a task",
    description:
      "Change a task's title, description, repo, priority, size or wave, or set its status to ready, blocked or cancelled (the moves allowed by hand). Planned fields are fixed while a dev-task run is open.",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      taskId: { kind: "task", description: "The task, by id (T-3), Jira key or title" },
      title: { kind: "text", description: "New title", required: false },
      description: { kind: "text", description: "New description", required: false },
      repo: { kind: "text", description: "New repo", required: false },
      priority: {
        kind: "enum",
        description: "Priority",
        values: ["low", "medium", "high", "critical"],
        synonyms: { low: ["minor", "p3", "lowest"], medium: ["normal", "med", "p2"], high: ["important", "p1"], critical: ["urgent", "highest", "p0", "blocker"] },
        required: false,
      },
      size: {
        kind: "enum",
        description: "Size",
        values: ["XS", "S", "M", "L"],
        synonyms: { XS: ["extra small", "tiny"], S: ["small"], M: ["medium"], L: ["large", "big"] },
        required: false,
      },
      wave: { kind: "number", description: "Wave", required: false },
      status: {
        kind: "enum",
        description: "Status: ready, blocked or cancelled",
        values: ["ready", "blocked", "cancelled"],
        synonyms: { ready: ["unblocked", "unblock", "not blocked", "ready to start"], blocked: ["block", "on hold", "stuck"], cancelled: ["cancel", "canceled", "dropped"] },
        required: false,
      },
    },
    utterances: [
      "rename [the] task {taskId} to {title}",
      "(change|update|set) [the] (title|name) of [the] task {taskId} to {title}",
      "(change|update|set) [the] description of [the] task {taskId} to {description}",
      "(change|update|set|move) [the] repo of [the] task {taskId} to {repo}",
      "(change|update|set) [the] priority (of|for|on) [the] task {taskId} to {priority}",
      "(change|update|set) task {taskId} priority to {priority}",
      "(make|set) [the] task {taskId} [to] {priority} priority",
      "(change|update|set) [the] size (of|for|on) [the] task {taskId} to {size}",
      "(change|update|set) task {taskId} size to {size}",
      "(move|put) [the] task {taskId} (to|into|in) wave {wave}",
      "(mark|set) [the] task {taskId} (as|to) {status}",
      "(mark|set) [the] task {taskId} (in|of|for|on) [the] project {projectId} (as|to) {status}",
      "(mark|set) [the] task {taskId} {status}",
    ],
    examples: ["Make task T-3 high priority", "Move task T-4 to wave 2", "Mark task T-5 as blocked"],
    covers: ["delivery.patchTask"],
    summary: async ({ projectId, taskId, ...fields }, ctx) => {
      const what = Object.entries(fields)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => (k === "status" ? `set it to ${v}` : k === "description" ? "change its description" : `${k} → ${v}`));
      return `${await taskLabel(projectId, taskId, ctx)}: ${what.join(", ") || "no changes"}`;
    },
    run: async ({ projectId, taskId, title, description, repo, priority, size, wave, status }, ctx) => {
      const body: TaskPatchBody = {
        ...(title?.trim() ? { title: title.trim() } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(repo?.trim() ? { repo: repo.trim() } : {}),
        ...(priority ? { priority } : {}),
        ...(size ? { size } : {}),
        ...(wave !== undefined ? { wave } : {}),
        ...(status ? { status } : {}),
      };
      if (!Object.keys(body).length) throw new Error("Tell me what to change: title, description, repo, priority, size, wave, or status (ready, blocked or cancelled).");
      const t = await delivery.patchTask(projectId, taskId, body);
      ctx.invalidate(projectId);
      return { text: `Task updated: ${boardLabel(t)} is ${taskStatusMeta(t.status).label.toLowerCase()}, wave ${t.wave}, ${t.size}, ${t.priority} priority.`, blocks: [{ type: "links", links: [{ label: "Open the task", href: href.task(projectId, t.id) }] }] };
    },
  }),
  defineTool({
    name: "retry_task",
    group: "tasks",
    title: "Retry a task",
    description: "Start a new dev-task run for a task that failed, was cancelled or needs rework, with its last feedback. Not for done tasks or tasks with an open run.",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      taskId: { kind: "task", description: "The task, by id (T-3), Jira key or title" },
    },
    utterances: [
      "(retry|rerun|re-run|restart) [the] task {taskId}",
      "(retry|rerun|re-run|restart) [the] task {taskId} (for|of|in|on) [the] [project] {projectId}",
      "(retry|rerun|re-run) {taskId}",
      "(retry|rerun|re-run) {taskId} (for|of|in|on) [the] [project] {projectId}",
      "(try|run) [the] task {taskId} again",
    ],
    examples: ["Retry task T-4"],
    covers: ["delivery.retryTask"],
    summary: async ({ projectId, taskId }, ctx) => `Retry ${await taskLabel(projectId, taskId, ctx)}`,
    preview: async ({ projectId, taskId }, ctx) => {
      const t = (await ctx.world.project(projectId)).tasks.find((x) => x.id === taskId);
      if (!t) return [];
      return [
        {
          type: "text",
          text: `Starts attempt ${t.runIds.length + 1} of ${boardLabel(t)} (now ${taskStatusMeta(t.status).label.toLowerCase()})${t.lastFeedback ? `, with the last feedback: “${clip(t.lastFeedback, 160)}”` : ""}.`,
        },
      ];
    },
    run: async ({ projectId, taskId }, ctx) => {
      const { runId } = await delivery.retryTask(projectId, taskId);
      ctx.invalidate(projectId);
      return { text: "dev-task run started.", blocks: [{ type: "links", links: [{ label: `Run ${runId}`, href: href.run(runId) }, { label: "Open the task", href: href.task(projectId, taskId) }] }] };
    },
  }),
] as const;
