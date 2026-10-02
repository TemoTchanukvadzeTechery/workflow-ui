import { delivery } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import { DEFAULT_BRD_OPTIONS, STAGES, stageDef, type Actor, type CreateProjectBody, type ProjectBundle, type StageId } from "@/lib/delivery/types";
import { formatBytes, formatRelative, formatUsd, plural } from "@/lib/format";
import { docStatusMeta, healthMeta, inboxItemText, inboxTierMeta, projectStatusMeta, stageStatusMeta, type StatusMeta } from "@/lib/weft/labels";
import { defineTool } from "../define";
import type { ResultBlock, ResultItem, ToolContext } from "../types";

// ---------------------------------------------------------------------------------------------
// Shared by the project, stage, epic, task and QA tools
// ---------------------------------------------------------------------------------------------

const enc = encodeURIComponent;

/** Links into the app (see src/app/projects and src/app/runs). */
export const href = {
  project: (id: string) => `/projects/${enc(id)}`,
  stage: (id: string, stage: StageId, step?: string) => `/projects/${enc(id)}/${stage}${step ? `?step=${enc(step)}` : ""}`,
  task: (id: string, taskId: string) => `/projects/${enc(id)}/tasks/${enc(taskId)}`,
  run: (runId: string) => `/runs/${enc(runId)}`,
  doc: (id: string, docId: string, v?: number) => `/projects/${enc(id)}/docs/${enc(docId)}${v ? `?v=${v}` : ""}`,
};

/** A status label for a result item (the icon stays out: results are kept in the chat history). */
export const pill = (m: StatusMeta): NonNullable<ResultItem["status"]> => ({ label: m.label, tone: m.tone });

export const clip = (s: string, n = 120) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
};

export const actorLabel = (a: Actor) => (a.kind === "human" || a.kind === "agent" ? a.name : a.kind === "policy" ? "Policy" : "System");

/** "[customer-service-v2] Coverage endpoint" → "Coverage endpoint". */
export const taskTitle = (title: string) => title.replace(/^\[[^\]]*\]\s*/, "");

/**
 * The stage a tool means when none was said: the page's stage when the page is this project,
 * else the project's current stage.
 */
export async function stageFor(projectId: string, stage: StageId | undefined, ctx: ToolContext): Promise<StageId> {
  if (stage) return stage;
  if (ctx.page.projectId === projectId && ctx.page.stage) return ctx.page.stage;
  return (await ctx.world.project(projectId)).project.currentStage;
}

/** The project's current BRD, AAD or plan (the stage's own doc first, as the stage pages pick it). */
export function docOf(b: ProjectBundle, kind: "brd" | "aad" | "plan") {
  const s = b.project.stages;
  const id = kind === "brd" ? s.requirements.brdDocId : kind === "aad" ? s.architecture.aadDocId : s.implementation.planDocId;
  return (id ? b.documents.find((d) => d.id === id) : undefined) ?? b.documents.find((d) => d.kind === kind && d.status !== "superseded");
}

export const DOC_LABEL: Record<"brd" | "aad" | "plan", string> = { brd: "BRD", aad: "AAD", plan: "implementation plan" };

const FRESH_MS = 3_000;
/** Characters of a document shown in the chat; the doc page has the rest. */
const DOC_CHARS = 4_000;
const ACTIVITY_LIMIT = 12;

function clipDoc(text: string): { text: string; clipped: boolean } {
  if (text.length <= DOC_CHARS) return { text, clipped: false };
  const cut = text.lastIndexOf("\n", DOC_CHARS);
  return { text: `${text.slice(0, cut > DOC_CHARS / 2 ? cut : DOC_CHARS).trimEnd()}\n\n…`, clipped: true };
}

function intakeBody(name: string, request: string | undefined, summary: string | undefined, start: boolean): CreateProjectBody {
  // What the New Project form sends: its default run options, no sources yet.
  return {
    name: name.trim(),
    ...(summary?.trim() ? { summary: summary.trim() } : {}),
    intake: { request: (request ?? "").trim(), sources: [], options: { ...DEFAULT_BRD_OPTIONS } },
    start,
  };
}

async function createAndLink(body: CreateProjectBody, ctx: ToolContext) {
  const { project } = await delivery.createProject(body);
  ctx.invalidate();
  const runId = project.stages.requirements.runIds.at(-1);
  const blocks: ResultBlock[] = [
    {
      type: "links",
      links: [
        { label: `Open ${stageDef(project.currentStage).title}`, href: href.stage(project.id, project.currentStage) },
        ...(runId ? [{ label: `Run ${runId}`, href: href.run(runId) }] : []),
        { label: "Project overview", href: href.project(project.id) },
      ],
    },
  ];
  return { project, blocks };
}

/** Projects: the portfolio, one project's state, creating and changing projects, notes, activity and documents. */
export const projectsTools = [
  defineTool({
    name: "list_projects",
    group: "projects",
    title: "List projects",
    description: "List every project with its current stage, status, health, how many items wait on people and its next step.",
    effect: "read",
    params: {},
    utterances: [
      "(show|list|see|view) [me] [all] [of] [my|the|our] projects",
      "(what|which) projects (are there|do we have|do i have|are active|are in flight|are running)",
      "how are [all] [my|the|our] projects (doing|going|looking)",
      "(project|projects) (list|overview|status)",
    ],
    examples: ["Show my projects", "How are the projects doing?"],
    covers: ["delivery.projects"],
    summary: () => "List the projects",
    run: async (_input, ctx) => {
      const projects = await ctx.world.projects();
      const done = projects.filter((p) => p.done).length;
      const waiting = projects.reduce((n, p) => n + p.waitingCount, 0);
      return {
        text: projects.length
          ? `${plural(projects.length, "project")}: ${projects.length - done} in flight, ${done} done${waiting ? `, ${plural(waiting, "item")} waiting on people` : ""}.`
          : "There are no projects yet.",
        blocks: [
          {
            type: "items",
            items: projects.map((p) => ({
              title: p.name,
              subtitle: `${p.done ? "Done" : stageDef(p.currentStage).title} · ${healthMeta(p.health).label}${p.nextStep ? ` · ${p.nextStep}` : ""}`,
              meta: p.waitingCount ? `${p.waitingCount} waiting` : undefined,
              href: href.project(p.id),
              status: pill(projectStatusMeta(p)),
            })),
            empty: "No projects yet.",
            more: { label: "All projects", href: "/projects" },
          },
        ],
      };
    },
  }),
  defineTool({
    name: "project_summary",
    group: "projects",
    title: "Summarize a project",
    description: "One project at a glance: its current stage, each stage's status, health and why, the next step, spend and what is waiting on people.",
    effect: "read",
    params: { projectId: { kind: "project", description: "The project" } },
    utterances: [
      "(summarize|summarise|recap) [the] [project] {projectId} [project]",
      "(give me|show [me]|get) [a|the] (summary|recap|overview|status) (of|for|on) [the] [project] {projectId}",
      "(how is|how's|hows) [the] [project] {projectId} (doing|going|coming along|looking)",
      "(what is|what's|whats) the (status|state) of [the] [project] {projectId}",
      "(where is|where's|wheres) [the] [project] {projectId} at",
      "(summarize|summarise|recap) [the|this] project",
    ],
    examples: ["Summarize {project}", "How is {project} doing?", "What's the status of {project}?"],
    covers: ["delivery.project"],
    summary: async ({ projectId }, ctx) => `Summarize ${await ctx.world.projectName(projectId)}`,
    run: async ({ projectId }, ctx) => {
      const b = await ctx.world.project(projectId);
      const p = b.project;
      const def = stageDef(p.currentStage);
      const status = stageStatusMeta(b.stages[p.currentStage].status);
      const health = healthMeta(b.health);
      const waiting = b.inbox.filter((i) => i.tier !== "fyi");
      const facts = [
        { label: "Stage", value: p.done ? "Done" : `${def.n}. ${def.title} · ${status.label}`, href: href.stage(p.id, p.currentStage) },
        { label: "Health", value: b.healthReason ? `${health.label}: ${b.healthReason}` : health.label },
        ...(b.nextStep ? [{ label: "Next step", value: b.nextStep.text, href: b.nextStep.href }] : []),
        { label: "Spend", value: formatUsd(b.spendUsd) },
        { label: "Waiting on people", value: String(waiting.length) },
      ];
      return {
        text: p.done
          ? `${p.name} is done.`
          : `${p.name} is at stage ${def.n}, ${def.title} (${status.label.toLowerCase()}), and ${health.label.toLowerCase()}.${b.nextStep ? ` Next: ${b.nextStep.text}.` : ""}`,
        blocks: [
          { type: "facts", title: p.name, facts },
          {
            type: "items",
            title: "Stages",
            items: STAGES.map((s) => ({ title: `${s.n}. ${s.title}`, subtitle: b.stages[s.id].metric, status: pill(stageStatusMeta(b.stages[s.id].status)), href: href.stage(p.id, s.id) })),
          },
          {
            type: "items",
            title: "Open items",
            items: b.inbox.map((i) => ({ title: inboxItemText(i), subtitle: stageDef(i.stage).title, status: pill(inboxTierMeta(i.tier)), href: i.href })),
            empty: "Nothing is waiting on anyone.",
          },
        ],
      };
    },
  }),
  defineTool({
    name: "dashboard_summary",
    group: "projects",
    title: "Show the key numbers",
    description: "The home dashboard's KPIs across all projects (active and done projects, items waiting on people, runs today, agents running, 30-day spend, tasks in flight) and what needs attention.",
    effect: "read",
    params: {},
    utterances: [
      "(show|give me|what are) [me] [the] (kpis|key numbers|metrics|stats|numbers)",
      "how are we doing [overall|today|this month]",
      "(summarize|summarise) [the] (dashboard|portfolio|pipeline)",
      "dashboard (summary|numbers|kpis)",
      "(what's|what is|whats) the big picture",
    ],
    examples: ["Show the KPIs", "How are we doing overall?"],
    covers: ["delivery.dashboard"],
    summary: () => "Show the dashboard numbers",
    run: async (_input, ctx) => {
      const d = await ctx.qc.fetchQuery({ queryKey: qk.dashboard, queryFn: delivery.dashboard, staleTime: FRESH_MS });
      const k = d.kpis;
      return {
        text: `${plural(k.activeProjects, "active project")}, ${k.doneProjects} done; ${plural(k.waitingOnPeople, "item")} waiting on people and ${plural(k.agentsRunning, "agent")} running.`,
        blocks: [
          {
            type: "facts",
            facts: [
              { label: "Active projects", value: String(k.activeProjects), href: "/projects" },
              { label: "Done", value: String(k.doneProjects) },
              { label: "Waiting on people", value: String(k.waitingOnPeople), href: "/inbox" },
              { label: "Runs today", value: String(k.runsToday), href: "/runs" },
              { label: "Agents running", value: String(k.agentsRunning) },
              { label: "Tasks in flight", value: String(k.tasksInFlight) },
              { label: "Spend, 30 days", value: formatUsd(k.spend30d) },
            ],
          },
          {
            type: "items",
            title: "Needs attention",
            items: d.attention.slice(0, 6).map((i) => ({ title: inboxItemText(i), subtitle: `${i.projectName} · ${stageDef(i.stage).title}`, status: pill(inboxTierMeta(i.tier)), href: i.href })),
            empty: "Nothing needs attention.",
            more: d.attention.length > 6 ? { label: `All ${d.attention.length} in the Inbox`, href: "/inbox" } : undefined,
          },
        ],
      };
    },
  }),
  defineTool({
    name: "create_project",
    group: "projects",
    title: "Create a project",
    description:
      "Create a project from the Product Owner's request, as the New Project form does (default run options, no sources), and start the po-brd requirements run unless start is false.",
    effect: "write",
    params: {
      name: { kind: "text", description: "Project name", ask: "What should the project be called?" },
      request: { kind: "text", description: "The Product Owner's request (the po-brd input)", ask: "What does the Product Owner want? A few sentences are enough; po-brd turns them into the BRD." },
      summary: { kind: "text", description: "One-line summary", required: false },
      start: { kind: "boolean", description: "Start the requirements run right away (default yes)", required: false },
    },
    utterances: [
      "(create|make|add|set up|start|open) [a] new project",
      "(create|make|add|set up|start) [a] [new] project (called|named|titled) {name}",
      "(create|make|add|set up|start) [a] [new] project (called|named|titled) {name} (with [the] request|requesting|asking for) {request}",
      "(create|make|add|set up|start) [a] [new] project (for|about) {request}",
      "new project (called|named) {name}",
    ],
    examples: ["Create a new project called Reorder Reminders", "Start a new project"],
    covers: ["delivery.createProject"],
    summary: ({ name, start }) => ((start ?? true) ? `Create ${name} and start the po-brd run` : `Create ${name} as a draft`),
    preview: ({ request, start }) => [
      { type: "facts", facts: [{ label: "Request", value: clip(request, 240) }] },
      {
        type: "text",
        text:
          (start ?? true)
            ? "po-brd searches Jira & Confluence first, then asks you to confirm the dependencies it found before drafting the BRD."
            : "Saved as a draft: no run starts until you start the requirements run.",
      },
    ],
    run: async ({ name, request, summary, start }, ctx) => {
      const run = start ?? true;
      const { project, blocks } = await createAndLink(intakeBody(name, request, summary, run), ctx);
      return { text: run ? `${project.name} created · po-brd is starting.` : `${project.name} saved as a draft.`, blocks };
    },
  }),
  defineTool({
    name: "save_project_draft",
    group: "projects",
    title: "Save a draft project",
    description: "Create a project without starting any run, like the New Project form's Save draft. Only a name is needed; the request can be added later.",
    effect: "write",
    params: {
      name: { kind: "text", description: "Project name", ask: "What should the project be called?" },
      request: { kind: "text", description: "The Product Owner's request", required: false },
      summary: { kind: "text", description: "One-line summary", required: false },
    },
    utterances: [
      "(save|create|add|make|start) [a] [new] draft project",
      "(save|create|add|make|start) [a] [new] draft project (called|named|titled) {name}",
      "(save|create|add|make) [a] [new] project (called|named|titled) {name} as [a] draft",
      "(save|create) [a] [new] project as [a] draft",
    ],
    examples: ["Save a draft project called SMS Consent"],
    covers: ["delivery.createProject"],
    summary: ({ name }) => `Save ${name} as a draft project`,
    run: async ({ name, request, summary }, ctx) => {
      const { project, blocks } = await createAndLink(intakeBody(name, request, summary, false), ctx);
      return { text: `${project.name} saved as a draft. Start the requirements run when the intake is ready.`, blocks };
    },
  }),
  defineTool({
    name: "update_project",
    group: "projects",
    title: "Change a project's name, summary or request",
    description: "Rename a project, change its one-line summary, or change the intake request the next po-brd run starts from.",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      name: { kind: "text", description: "New name", required: false },
      summary: { kind: "text", description: "New summary", required: false },
      request: { kind: "text", description: "New intake request", required: false },
    },
    utterances: [
      "rename [the] [project] {projectId} to {name}",
      "(change|update|set) [the] (name|title) of [the] [project] {projectId} to {name}",
      "(change|update|set) [the] summary (of|for|on) [the] [project] {projectId} to {summary}",
      "(change|update|set) [the] summary to {summary}",
      "(change|update|set) [the] [intake] request (of|for|on) [the] [project] {projectId} to {request}",
      "(change|update|set) [the] [intake] request to {request}",
    ],
    examples: ["Rename {project} to Agreement Reports", "Change the request of {project} to Add a monthly export"],
    covers: ["delivery.updateIntake"],
    summary: async ({ projectId, name, summary, request }, ctx) => {
      const current = await ctx.world.projectName(projectId);
      const what = [name ? `rename it to ${name}` : null, summary !== undefined ? "change its summary" : null, request !== undefined ? "change its request" : null].filter(Boolean);
      return what.length ? `${current}: ${what.join(", ")}` : `Update ${current}`;
    },
    run: async ({ projectId, name, summary, request }, ctx) => {
      const patch = { ...(name ? { name } : {}), ...(summary !== undefined ? { summary } : {}), ...(request !== undefined ? { request } : {}) };
      if (!Object.keys(patch).length) throw new Error("Tell me what to change: a new name, summary or request.");
      const before = await ctx.world.projectName(projectId);
      const { project } = await delivery.updateIntake(projectId, patch);
      ctx.invalidate(projectId);
      const done = [name ? `renamed ${before} to ${project.name}` : null, summary !== undefined ? "saved the summary" : null, request !== undefined ? "saved the request (the next po-brd run uses it)" : null].filter(Boolean).join(", ");
      return { text: `Saved: ${done}.`, blocks: [{ type: "links", links: [{ label: project.name, href: href.project(project.id) }] }] };
    },
  }),
  defineTool({
    name: "delete_project",
    group: "projects",
    title: "Delete a project",
    description: "Delete a project with its stages, documents, epics, tasks and activity. Its weft runs stay in the run list.",
    effect: "destructive",
    params: { projectId: { kind: "project", description: "The project to delete" } },
    utterances: ["(delete|remove|drop|trash|get rid of) [the] [whole] project {projectId}", "(delete|remove|drop|trash) [the] {projectId} project", "(delete|remove|drop|trash) (this|the current) project"],
    examples: ["Delete the project {project}"],
    covers: ["delivery.deleteProject"],
    summary: async ({ projectId }, ctx) => `Delete ${await ctx.world.projectName(projectId)}`,
    preview: async ({ projectId }, ctx) => {
      const b = await ctx.world.project(projectId);
      return [{ type: "text", tone: "danger", text: `This deletes ${b.project.name}: ${plural(b.documents.length, "document")}, ${plural(b.epics.length, "epic")}, ${plural(b.tasks.length, "task")} and its activity.` }];
    },
    run: async ({ projectId }, ctx) => {
      const name = await ctx.world.projectName(projectId);
      await delivery.deleteProject(projectId);
      if (ctx.page.projectId === projectId) ctx.navigate("/projects");
      ctx.invalidate();
      return { text: `Deleted ${name}.`, blocks: [{ type: "links", links: [{ label: "All projects", href: "/projects" }] }] };
    },
  }),
  defineTool({
    name: "add_stage_note",
    group: "projects",
    title: "Add a note to a stage",
    description: "Add a note to a stage of a project; the stage's next agent run receives it. Without a stage, the page's stage or the project's current stage.",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      stage: { kind: "stage", description: "The stage", required: false, fromPage: false },
      text: { kind: "text", description: "The note", ask: "What should the note say?" },
    },
    utterances: [
      "(add|leave|write|post) [a] note (to|on|for|in) [the] {stage} [stage]",
      "(add|leave|write|post) [a] note (to|on|for|in) [the] {stage} [stage] (of|for|in|on) [the] [project] {projectId}",
      "(add|leave|write|post) [a] note (to|on|for|in) [the] {stage} [stage] (of|for|in|on) [the] [project] {projectId} (saying|that says) {text}",
      "(add|leave|write|post) [a] note (to|on|for|in) [the] {stage} [stage] (saying|that says) {text}",
      "(add|leave|write|post) [a] note (to|on|for|in) [the] [project] {projectId} (saying|that says) {text}",
      "(add|leave|write|post) [a] note (to|on|for|in) {projectId}'s {stage} [stage] (saying|that says) {text}",
      "(add|leave|write|post) [a] [stage] note (saying|that says) {text}",
      "(add|leave|write|post) [a] note: {text}",
      "(add|leave|write|post) [a] note",
    ],
    examples: ["Add a note to the architecture stage of {project}", "Add a note saying Reuse the existing consent table"],
    covers: ["delivery.addNote"],
    summary: async ({ projectId, stage, text }, ctx) => `Add a note to ${stageDef(await stageFor(projectId, stage, ctx)).title} of ${await ctx.world.projectName(projectId)}: “${clip(text, 80)}”`,
    run: async ({ projectId, stage, text }, ctx) => {
      const s = await stageFor(projectId, stage, ctx);
      await delivery.addNote(projectId, { stage: s, text });
      ctx.invalidate(projectId);
      return {
        text: `Added the note to ${stageDef(s).title} of ${await ctx.world.projectName(projectId)}. The stage's next run receives it.`,
        blocks: [{ type: "links", links: [{ label: `Open ${stageDef(s).title}`, href: href.stage(projectId, s) }] }],
      };
    },
  }),
  defineTool({
    name: "delete_stage_note",
    group: "projects",
    title: "Delete a stage note",
    description: "Delete a note from one of a project's stages, found by its id or its text.",
    effect: "destructive",
    params: {
      projectId: { kind: "project", description: "The project" },
      noteId: { kind: "stage-note", description: "The note, by id or what it says" },
    },
    utterances: [
      "(delete|remove) [the] [stage] note {noteId}",
      "(delete|remove) [the] [stage] note (about|saying|that says|on) {noteId}",
      "(delete|remove) [the] [stage] note (about|saying|that says|on) {noteId} (from|in|on) [the] [project] {projectId}",
      "(delete|remove) [the] [stage] note {noteId} (from|in|on) [the] [project] {projectId}",
    ],
    examples: ["Delete the note about streaming the CSV"],
    covers: ["delivery.deleteNote"],
    summary: async ({ projectId, noteId }, ctx) => {
      const b = await ctx.world.project(projectId);
      const s = STAGES.find((x) => b.project.stages[x.id].notes.some((n) => n.id === noteId));
      const note = s ? b.project.stages[s.id].notes.find((n) => n.id === noteId) : undefined;
      return note && s ? `Delete the note “${clip(note.text, 60)}” from ${s.title} of ${b.project.name}` : `Delete note ${noteId} from ${b.project.name}`;
    },
    run: async ({ projectId, noteId }, ctx) => {
      await delivery.deleteNote(projectId, noteId);
      ctx.invalidate(projectId);
      return { text: `Deleted the note from ${await ctx.world.projectName(projectId)}.` };
    },
  }),
  defineTool({
    name: "project_activity",
    group: "projects",
    title: "Show recent activity",
    description: "The latest activity (runs, decisions, epics, tasks, notes) for one project, or across all projects when none is given.",
    effect: "read",
    params: { projectId: { kind: "project", description: "The project (all projects when not given)", required: false } },
    utterances: [
      "(show|list|what's|what is|whats) [the|all] [recent|latest] activity",
      "(show|list|what's|what is|whats) [the] [recent|latest] activity (for|on|in|of) [the] [project] {projectId}",
      "what (happened|has happened|changed) [recently|lately|today]",
      "what (happened|has happened|changed) (on|in|with|to) [the] [project] {projectId} [recently|lately|today]",
      "(show|list) [the] (history|log) (of|for) [the] [project] {projectId}",
    ],
    examples: ["Show the recent activity for {project}", "What happened recently?"],
    covers: ["delivery.activity"],
    summary: async ({ projectId }, ctx) => (projectId ? `Show recent activity in ${await ctx.world.projectName(projectId)}` : "Show recent activity"),
    run: async ({ projectId }, ctx) => {
      const list = await ctx.qc.fetchQuery({
        queryKey: qk.activity(projectId, ACTIVITY_LIMIT),
        queryFn: () => delivery.activity({ projectId, limit: ACTIVITY_LIMIT }),
        staleTime: FRESH_MS,
      });
      const names = projectId ? undefined : new Map((await ctx.world.projects()).map((p) => [p.id, p.name]));
      const where = projectId ? await ctx.world.projectName(projectId) : "all projects";
      return {
        text: list.length ? `The latest ${plural(list.length, "event")} in ${where}.` : `Nothing has happened in ${where} yet.`,
        blocks: [
          {
            type: "items",
            items: list.map((a) => ({
              title: a.text,
              subtitle: `${names ? `${names.get(a.projectId) ?? a.projectId} · ` : ""}${stageDef(a.stage).title} · ${actorLabel(a.actor)}`,
              meta: formatRelative(a.at),
              href: a.href ?? href.stage(a.projectId, a.stage),
            })),
            empty: "No activity yet.",
          },
        ],
      };
    },
  }),
  defineTool({
    name: "list_workspace_files",
    group: "projects",
    title: "List workspace files",
    description: "List files in the po-workspace under a path prefix (default notes/), e.g. the note files an intake can use as sources.",
    effect: "read",
    params: { prefix: { kind: "text", description: "Path prefix (default notes/)", required: false } },
    utterances: [
      "(show|list) [the|all] [workspace] (note|notes) files",
      "(show|list) [the|all] workspace files",
      "(show|list) [the|all] [workspace] files (in|under) {prefix}",
      "(what|which) files are (in|under) {prefix}",
      "(what|which) (note|notes) files (are there|do we have)",
    ],
    examples: ["List the note files", "Show the files under notes/compliance-export"],
    covers: ["delivery.workspaceFiles"],
    summary: ({ prefix }) => `List the workspace files under ${prefix ?? "notes/"}`,
    run: async ({ prefix }, ctx) => {
      const p = (prefix ?? "notes/").trim().replace(/^\/+/, "") || "notes/";
      const files = await ctx.qc.fetchQuery({ queryKey: qk.workspaceFiles(p), queryFn: () => delivery.workspaceFiles(p), staleTime: FRESH_MS });
      return {
        text: files.length ? `${plural(files.length, "file")} under ${p}. Add one to an intake as a note file source.` : `There are no files under ${p}.`,
        blocks: [{ type: "items", items: files.map((f) => ({ title: f.path, subtitle: `Updated ${formatRelative(f.updatedAt)}`, meta: formatBytes(f.size) })), empty: "No files." }],
      };
    },
  }),
  defineTool({
    name: "show_document",
    group: "projects",
    title: "Show a document",
    description: "Show the text of a project's BRD, AAD or implementation plan (the latest version, or a given version number), with a link to the document page.",
    effect: "read",
    params: {
      projectId: { kind: "project", description: "The project" },
      doc: { kind: "doc", description: "Which document: brd, aad or plan" },
      version: { kind: "number", description: "Version number (latest when not given)", required: false },
    },
    utterances: [
      "(show|read|display|view|print) [me] [the] {doc} [document|doc] (of|for|from|in|on) [the] [project] {projectId}",
      "(show|read|display|view|open) [me] [the] [current|latest] {doc} (document|doc)",
      "read [me] [the] {doc}",
      "(show|read|display|view) [me] version {version} of [the] {doc} [document|doc] (of|for|from|in|on) [the] [project] {projectId}",
      "(show|read|display|view) [me] version {version} of [the] {doc} [document|doc]",
    ],
    examples: ["Read the BRD of {project}", "Show version 1 of the AAD for {project}"],
    covers: ["delivery.doc"],
    summary: async ({ projectId, doc, version }, ctx) => `Show the ${DOC_LABEL[doc]}${version ? ` v${version}` : ""} of ${await ctx.world.projectName(projectId)}`,
    run: async ({ projectId, doc, version }, ctx) => {
      const b = await ctx.world.project(projectId);
      const d = docOf(b, doc);
      if (!d) throw new Error(`${b.project.name} has no ${DOC_LABEL[doc]} yet.`);
      const r = await ctx.qc.fetchQuery({ queryKey: qk.doc(projectId, d.id, version), queryFn: () => delivery.doc(projectId, d.id, version), staleTime: FRESH_MS });
      const shown = clipDoc(r.text);
      const label = doc === "plan" ? "Implementation plan" : DOC_LABEL[doc];
      const link = href.doc(projectId, d.id, version);
      return {
        text: `${label} v${r.version.n} of ${b.project.name} (${docStatusMeta(d.status).label.toLowerCase()})${shown.clipped ? "; here is the start of it, the document page has the rest" : ""}.`,
        blocks: [
          { type: "markdown", title: `${label} v${r.version.n} · ${d.title}`, text: shown.text, href: link },
          { type: "links", links: [{ label: `Open the ${DOC_LABEL[doc]}`, href: link }] },
        ],
      };
    },
  }),
] as const;
