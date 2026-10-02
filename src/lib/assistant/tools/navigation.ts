import { stageDef, type StageId } from "@/lib/delivery/types";
import { defineTool } from "../define";
import { PAGE_HREF } from "../slots";
import type { PageId } from "../types";

const PAGE_TITLE: Record<PageId, string> = {
  home: "Home",
  inbox: "the Inbox",
  projects: "Projects",
  "new-project": "the new project form",
  runs: "Runs",
  memory: "Memory",
  settings: "Settings",
};

const enc = encodeURIComponent;
const noteHref = (id: string) => `/memory/${id.split("/").map(enc).join("/")}`;

/** Moving around the app: pages, projects and their stages, runs, memory notes, the ⌘K palette. */
export const navigationTools = [
  defineTool({
    name: "open_page",
    group: "navigation",
    title: "Open a page",
    description: "Navigate to a top-level page: home, inbox, projects, new-project, runs, memory or settings.",
    effect: "read",
    params: { page: { kind: "page", description: "The page to open" } },
    utterances: ["(open|show|go to|goto|take me to|navigate to|switch to|bring up) [the] {page} [page|tab|screen]", "[go] (back|home) [to] [the] {page}", "(open|go to) [my] {page}"],
    examples: ["Open the inbox", "Go to settings", "Take me to the runs page"],
    covers: [],
    summary: ({ page }) => `Open ${PAGE_TITLE[page]}`,
    run: async ({ page }, ctx) => {
      ctx.navigate(PAGE_HREF[page]);
      return { text: `Opened ${PAGE_TITLE[page]}.` };
    },
  }),
  defineTool({
    name: "open_project",
    group: "navigation",
    title: "Open a project",
    description: "Navigate to a project's overview, or to one of its stage pages when a stage is given.",
    effect: "read",
    params: {
      projectId: { kind: "project", description: "The project", fromPage: false },
      stage: { kind: "stage", description: "A stage page to open instead of the overview", required: false, fromPage: false },
    },
    utterances: [
      "(open|show|go to|take me to|navigate to|switch to) [the] [project] {projectId} [project]",
      "(open|show|go to|take me to) [the] {stage} [stage|page|tab] (of|for|in|on) [project] {projectId}",
      "(open|show|go to|take me to) {projectId}'s {stage} [stage|page]",
    ],
    examples: ["Open {project}", "Go to the QA stage of {project}"],
    covers: [],
    summary: async ({ projectId, stage }, ctx) => {
      const name = await ctx.world.projectName(projectId);
      return stage ? `Open ${stageDef(stage).title} of ${name}` : `Open ${name}`;
    },
    run: async ({ projectId, stage }, ctx) => {
      const name = await ctx.world.projectName(projectId);
      ctx.navigate(stage ? `/projects/${enc(projectId)}/${stage}` : `/projects/${enc(projectId)}`);
      return { text: stage ? `Opened ${stageDef(stage as StageId).title} of ${name}.` : `Opened ${name}.` };
    },
  }),
  defineTool({
    name: "open_run",
    group: "navigation",
    title: "Open a run",
    description: "Navigate to a weft run's page (its steps, logs, report and requests).",
    effect: "read",
    params: { runId: { kind: "run", description: "The run id, or 'latest'", fromPage: false } },
    utterances: ["(open|show|go to|take me to) [the] run {runId}", "(open|show|go to) [the] {runId} run"],
    examples: ["Open the latest run"],
    covers: [],
    summary: ({ runId }) => `Open run ${runId}`,
    run: async ({ runId }, ctx) => {
      ctx.navigate(`/runs/${enc(runId)}`);
      return { text: `Opened run ${runId}.` };
    },
  }),
  defineTool({
    name: "open_memory_note",
    group: "navigation",
    title: "Open a memory note",
    description: "Navigate to a memory vault note's page by its id (`<type>/<slug>`) or a search for it.",
    effect: "read",
    params: { noteId: { kind: "note", description: "Memory note id or what it is about", fromPage: false } },
    utterances: ["(open|show|go to|take me to) [the] [memory] note [about|on|for] {noteId}", "(open|show) {noteId} in memory"],
    examples: ["Open the memory note about customer service"],
    covers: [],
    summary: ({ noteId }) => `Open memory note ${noteId}`,
    run: async ({ noteId }, ctx) => {
      ctx.navigate(noteHref(noteId));
      return { text: `Opened ${noteId}.` };
    },
  }),
  defineTool({
    name: "open_command_palette",
    group: "navigation",
    title: "Open the command palette",
    description: "Open the ⌘K palette, optionally searching for something: pages, projects, stages, runs, inbox items and memory notes.",
    effect: "read",
    params: { query: { kind: "text", description: "What to search for", required: false } },
    utterances: ["(open|show) [the] (command palette|palette|search)", "(find|jump to|look for) {query}"],
    examples: ["Open the command palette", "Jump to agreement reporting"],
    covers: [],
    summary: ({ query }) => (query ? `Search the palette for “${query}”` : "Open the command palette"),
    run: async ({ query }, ctx) => {
      ctx.openPalette(query ?? "");
      return { text: query ? `Opened the palette with “${query}”.` : "Opened the palette." };
    },
  }),
] as const;
