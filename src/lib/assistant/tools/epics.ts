import { delivery } from "@/lib/api/client";
import type { Epic, EpicUpsertBody, ProjectBundle } from "@/lib/delivery/types";
import { plural } from "@/lib/format";
import { epicStatusMeta } from "@/lib/weft/labels";
import { defineTool } from "../define";
import type { ResultItem, ToolContext } from "../types";
import { clip, href, pill } from "./projects";

type EpicStage = "requirements" | "architecture";

/** Epics are edited on Requirements until it is approved, then on Architecture. */
const epicStage = (b: ProjectBundle): EpicStage => (b.project.stages.requirements.approvedAt ? "architecture" : "requirements");
const epicsHref = (b: ProjectBundle, stage = epicStage(b)) => href.stage(b.project.id, stage, "epics");
const epicName = (e: Pick<Epic, "key" | "title">) => (e.key ? `${e.key} · ${e.title}` : e.title);

/** Parked epics (blocked by open questions) stay draft when the rest are accepted (store.isParked). */
const isParked = (e: Epic) => e.status === "draft" && !!e.blockedBy?.length;

function epicItem(b: ProjectBundle, e: Epic): ResultItem {
  const refs = [...e.brdRequirementRefs, ...e.aadRefs];
  return {
    title: epicName(e),
    subtitle: e.objective ? clip(e.objective, 100) : undefined,
    meta: refs.length ? refs.join(", ") : undefined,
    href: epicsHref(b),
    status: pill(epicStatusMeta(e.status)),
  };
}

/** The stage whose epics to accept: the one asked for, the page's, else the one epics are on now. */
async function acceptStage(projectId: string, stage: EpicStage | undefined, ctx: ToolContext): Promise<EpicStage> {
  if (stage) return stage;
  if (ctx.page.projectId === projectId && (ctx.page.stage === "requirements" || ctx.page.stage === "architecture")) return ctx.page.stage;
  return epicStage(await ctx.world.project(projectId));
}

async function epicTitle(projectId: string, epicId: string, ctx: ToolContext): Promise<string> {
  const e = (await ctx.world.project(projectId)).epics.find((x) => x.id === epicId);
  return e ? epicName(e) : epicId;
}

/** Epics: listing, adding, editing and deleting them, accepting them at a gate, creating them in (mock) Jira. */
export const epicsTools = [
  defineTool({
    name: "list_epics",
    group: "epics",
    title: "List epics",
    description: "List a project's epics with their status (draft, accepted, in Jira), Jira key, objective and the BR/FR refs they cover.",
    effect: "read",
    params: { projectId: { kind: "project", description: "The project" } },
    utterances: [
      "(show|list|see|view) [me] [all] [the] epics (for|of|in|on) [the] [project] {projectId}",
      "(show|list|see|view) [me] [all] [the] epics",
      "(what|which) epics (are there|do we have|does it have)",
      "(what|which) epics does [the] [project] {projectId} have",
    ],
    examples: ["Show the epics for {project}", "List the epics"],
    covers: ["delivery.project"],
    summary: async ({ projectId }, ctx) => `List the epics of ${await ctx.world.projectName(projectId)}`,
    run: async ({ projectId }, ctx) => {
      const b = await ctx.world.project(projectId);
      const count = (s: Epic["status"]) => b.epics.filter((e) => e.status === s).length;
      return {
        text: b.epics.length
          ? `${b.project.name} has ${plural(b.epics.length, "epic")}: ${count("draft")} draft, ${count("accepted")} accepted, ${count("synced")} in Jira.`
          : `${b.project.name} has no epics yet; they are proposed from the BRD.`,
        blocks: [{ type: "items", items: b.epics.map((e) => epicItem(b, e)), empty: "No epics yet.", more: { label: "Open the epics", href: epicsHref(b) } }],
      };
    },
  }),
  defineTool({
    name: "add_epic",
    group: "epics",
    title: "Add an epic",
    description: "Add an epic by hand to a project, as a draft on the stage that currently edits epics (Requirements, or Architecture once Requirements is approved).",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      title: { kind: "text", description: "Epic title", ask: "What should the epic be called?" },
      objective: { kind: "text", description: "What the epic achieves", required: false },
    },
    utterances: [
      "(add|create|propose|new) [a|an] [new] epic",
      "(add|create|propose) [a|an] [new] epic (called|named|titled|for) {title}",
      "(add|create|propose) [a|an] [new] epic (called|named|titled|for) {title} (to|in) [the] project {projectId}",
      "(add|create|propose) [a|an] [new] epic (called|named|titled|for) {title} (with [the] objective|to|so that) {objective}",
    ],
    examples: ["Add an epic called Export audit trail", "Add a new epic"],
    covers: ["delivery.upsertEpic"],
    summary: async ({ projectId, title }, ctx) => `Add the epic “${title}” to ${await ctx.world.projectName(projectId)}`,
    run: async ({ projectId, title, objective }, ctx) => {
      const body: EpicUpsertBody = { title: title.trim(), ...(objective?.trim() ? { objective: objective.trim() } : {}) };
      const epic = await delivery.upsertEpic(projectId, body);
      ctx.invalidate(projectId);
      const b = await ctx.world.project(projectId);
      return { text: `Epic added: ${epic.title} (draft). Accept the epics when they're ready.`, blocks: [{ type: "links", links: [{ label: "Open the epics", href: epicsHref(b) }] }] };
    },
  }),
  defineTool({
    name: "update_epic",
    group: "epics",
    title: "Edit an epic",
    description: "Change an epic's title or objective. Only the fields given change, and the epic's history names them.",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      epicId: { kind: "epic", description: "The epic, by id, Jira key or title" },
      title: { kind: "text", description: "New title", required: false },
      objective: { kind: "text", description: "New objective", required: false },
    },
    utterances: [
      "rename [the] epic {epicId} to {title}",
      "rename [the] epic {epicId} (in|of|for|on) [the] project {projectId} to {title}",
      "(change|update|set) [the] (title|name) of [the] epic {epicId} to {title}",
      "(change|update|set) [the] (objective|goal) of [the] epic {epicId} to {objective}",
      "(change|update|set) [the] epic {epicId} (objective|goal) to {objective}",
    ],
    examples: ["Rename the epic EP-1 to CSV export of agreements"],
    covers: ["delivery.upsertEpic"],
    summary: async ({ projectId, epicId, title, objective }, ctx) => {
      const name = await epicTitle(projectId, epicId, ctx);
      const what = [title ? `rename it to “${title}”` : null, objective !== undefined ? "change its objective" : null].filter(Boolean);
      return what.length ? `Epic ${name}: ${what.join(", ")}` : `Edit epic ${name}`;
    },
    run: async ({ projectId, epicId, title, objective }, ctx) => {
      const current = (await ctx.world.project(projectId)).epics.find((e) => e.id === epicId);
      // Send only what changed, as the epic sheet does.
      const body: EpicUpsertBody = {
        id: epicId,
        ...(title?.trim() && title.trim() !== current?.title ? { title: title.trim() } : {}),
        ...(objective !== undefined && objective.trim() !== current?.objective ? { objective: objective.trim() } : {}),
      };
      if (Object.keys(body).length === 1) throw new Error(title || objective ? "That's what the epic already says." : "Tell me what to change: a new title or objective.");
      const epic = await delivery.upsertEpic(projectId, body);
      ctx.invalidate(projectId);
      const b = await ctx.world.project(projectId);
      return { text: `Epic updated: ${epicName(epic)}.`, blocks: [{ type: "links", links: [{ label: "Open the epics", href: epicsHref(b) }] }] };
    },
  }),
  defineTool({
    name: "delete_epic",
    group: "epics",
    title: "Delete an epic",
    description: "Delete an epic from a project.",
    effect: "destructive",
    params: {
      projectId: { kind: "project", description: "The project" },
      epicId: { kind: "epic", description: "The epic, by id, Jira key or title" },
    },
    utterances: ["(delete|remove|drop) [the] epic {epicId}", "(delete|remove|drop) [the] epic {epicId} (from|in|of) [the] project {projectId}"],
    examples: ["Delete the epic EP-3"],
    covers: ["delivery.deleteEpic"],
    summary: async ({ projectId, epicId }, ctx) => `Delete the epic ${await epicTitle(projectId, epicId, ctx)} from ${await ctx.world.projectName(projectId)}`,
    preview: async ({ projectId, epicId }, ctx) => {
      const b = await ctx.world.project(projectId);
      const e = b.epics.find((x) => x.id === epicId);
      const tasks = b.tasks.filter((t) => t.epicId === epicId).length;
      return e?.key || tasks ? [{ type: "text", tone: "attention", text: `${e?.key ? `${e.key} stays in Jira. ` : ""}${tasks ? `${plural(tasks, "task")} belong to this epic.` : ""}`.trim() }] : [];
    },
    run: async ({ projectId, epicId }, ctx) => {
      const name = await epicTitle(projectId, epicId, ctx);
      await delivery.deleteEpic(projectId, epicId);
      ctx.invalidate(projectId);
      return { text: `Epic deleted: ${name}.` };
    },
  }),
  defineTool({
    name: "accept_epics",
    group: "epics",
    title: "Accept the epics",
    description:
      "Accept a project's draft epics at Requirements (needs the accepted BRD), or the epic updates from the AAD at Architecture. Epics parked by open questions stay draft. Without a stage, the page's or the one epics are on now.",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      stage: {
        kind: "enum",
        description: "requirements (the epics from the BRD) or architecture (the updates from the AAD)",
        values: ["requirements", "architecture"],
        synonyms: { requirements: ["brd", "stage 1", "requirement"], architecture: ["aad", "stage 2", "arch"] },
        required: false,
      },
    },
    utterances: [
      "(accept|approve|confirm) [all] [the] [draft|proposed] epics",
      "(accept|approve|confirm) [all] [the] [draft|proposed] epics (for|of|on|in) [the] [project] {projectId}",
      "(accept|approve|confirm) [all] [the] epic (updates|changes) [from the aad]",
      "(accept|approve|confirm) [all] [the] epic (updates|changes) [from the aad] (for|of|on|in) [the] [project] {projectId}",
      "(accept|approve|confirm) [all] [the] {stage} epics [for|of|on|in] [the] [project] {projectId}",
      "(accept|approve|confirm) [all] [the] {stage} epics",
    ],
    examples: ["Accept the epics for {project}", "Accept the epic updates"],
    covers: ["delivery.acceptEpics"],
    summary: async ({ projectId, stage }, ctx) => {
      const s = await acceptStage(projectId, stage, ctx);
      return `${s === "requirements" ? "Accept the epics" : "Accept the epic updates from the AAD"} of ${await ctx.world.projectName(projectId)}`;
    },
    preview: async ({ projectId, stage }, ctx) => {
      const b = await ctx.world.project(projectId);
      const s = await acceptStage(projectId, stage, ctx);
      const drafts = b.epics.filter((e) => e.status === "draft" && !isParked(e));
      const parked = b.epics.filter(isParked);
      return [
        {
          type: "items",
          title: drafts.length ? `${plural(drafts.length, "draft epic")} to accept` : undefined,
          items: drafts.map((e) => epicItem(b, e)),
          empty: s === "requirements" ? "No draft epics to accept." : "No new epics; this accepts the AAD's changes to the existing ones.",
        },
        ...(parked.length ? [{ type: "text" as const, tone: "attention" as const, text: `Parked by open questions, staying draft: ${parked.map((e) => `${e.title} (${e.blockedBy?.join(", ")})`).join("; ")}.` }] : []),
      ];
    },
    run: async ({ projectId, stage }, ctx) => {
      const s = await acceptStage(projectId, stage, ctx);
      const b = await delivery.acceptEpics(projectId, s);
      ctx.invalidate(projectId);
      const toSync = b.epics.filter((e) => e.status === "accepted" && !e.key).length;
      return {
        text: `Epics accepted.${toSync ? ` ${plural(toSync, "epic")} can be created in Jira now.` : ""}`,
        blocks: [{ type: "links", links: [{ label: "Open the epics", href: epicsHref(b, s) }] }],
      };
    },
  }),
  defineTool({
    name: "create_epics_in_jira",
    group: "epics",
    title: "Create the epics in Jira",
    description: "Create a project's accepted epics in Jira (a mock: keys are allocated locally) and give planned tasks their Jira keys.",
    effect: "write",
    params: { projectId: { kind: "project", description: "The project" } },
    utterances: [
      "(create|sync|push|send|put) [all] [the] [accepted] epics (in|to|into|with) jira",
      "(create|sync|push|send|put) [all] [the] [accepted] epics (in|to|into|with) jira (for|of|on) [the] [project] {projectId}",
      "(create|sync|push|send|put) [all] [the] [accepted] [epics] (of|for) [the] [project] {projectId} (in|to|into|with) jira",
      "sync [the] epics",
    ],
    examples: ["Create the epics in Jira", "Push the epics to Jira for {project}"],
    covers: ["delivery.syncEpics"],
    summary: async ({ projectId }, ctx) => `Create the accepted epics of ${await ctx.world.projectName(projectId)} in Jira (mock)`,
    preview: async ({ projectId }, ctx) => {
      const b = await ctx.world.project(projectId);
      const todo = b.epics.filter((e) => e.status === "accepted" && !e.key);
      return [{ type: "items", title: todo.length ? `${plural(todo.length, "epic")} to create` : undefined, items: todo.map((e) => epicItem(b, e)), empty: "No accepted epics are waiting for Jira." }];
    },
    run: async ({ projectId }, ctx) => {
      const before = new Set((await ctx.world.project(projectId)).epics.filter((e) => e.key).map((e) => e.id));
      const b = await delivery.syncEpics(projectId);
      ctx.invalidate(projectId);
      const created = b.epics.filter((e) => e.key && !before.has(e.id));
      return {
        text: `Epics created in Jira (mock): ${created.map((e) => e.key).join(", ") || "none"}.`,
        blocks: [{ type: "items", items: created.map((e) => epicItem(b, e)) }],
      };
    },
  }),
] as const;
