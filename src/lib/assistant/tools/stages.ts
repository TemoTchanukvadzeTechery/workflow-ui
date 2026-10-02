import { delivery } from "@/lib/api/client";
import { readyForTestDraft } from "@/lib/delivery/ready-for-test";
import { DEFAULT_AAD_OPTIONS, STAGES, stageDef, type DecisionBody, type ImportBody, type ProjectBundle, type StageId, type StartArchitectureBody } from "@/lib/delivery/types";
import { plural } from "@/lib/format";
import { stageStatusMeta } from "@/lib/weft/labels";
import { defineTool } from "../define";
import type { ResultBlock, ResultItem, ToolContext, ToolResult } from "../types";
import { clip, docOf, href, stageFor } from "./projects";

type DocStage = "requirements" | "architecture";

const DOC_OF: Record<DocStage, "BRD" | "AAD"> = { requirements: "BRD", architecture: "AAD" };

/** What approving each gate does, as the gate's toast says it. */
const APPROVED_TEXT: Record<StageId, string> = {
  requirements: "Requirements approved; moved to Architecture",
  architecture: "Architecture approved; moved to Implementation",
  implementation: "Handed off to QA",
  qa: "Certified; sent to PO Review",
  signoff: "Signed off; project done",
};

/** Where the rework happens, since a gate change request only records the decision (GateFooter). */
const REWORK_ROUTE: Partial<Record<StageId, string>> = {
  requirements: "To have po-brd rework the BRD, choose Revise in the BRD review, or start another run.",
  architecture: "To have architect-aad rework the AAD, choose Revise in the AAD review, or start another run.",
  implementation: "To send a task back to its agent, request changes in that task's review.",
  qa: "To send a task back to implementation, choose Bugs found in its QA review.",
};

const DOC_STAGE = {
  kind: "enum",
  description: "Which document: the BRD (requirements) or the AAD (architecture)",
  values: ["requirements", "architecture"],
  synonyms: {
    requirements: ["brd", "po-brd", "requirements doc", "requirements document", "business requirements", "stage 1", "1"],
    architecture: ["aad", "architect-aad", "arch", "architecture doc", "architecture document", "design doc", "stage 2", "2"],
  },
  ask: "Which document: the BRD or the AAD?",
} as const;

/**
 * Warnings each approval card showed, per project and stage. Confirming the card acknowledges
 * them, as ticking each one at the gate does; a warning that appeared after the card was shown
 * was not seen, so the approval stops and asks again rather than acknowledging it blind.
 */
const shownWarnings = new Map<string, string[]>();

const blockerItems = (b: ProjectBundle, stage: StageId): ResultItem[] => {
  const view = b.stages[stage];
  const linked = view.blockerItems && view.blockerItems.length === view.blockers.length ? view.blockerItems : view.blockers.map((text) => ({ text, href: undefined }));
  return linked.map((x) => ({ title: x.text, href: x.href }));
};

const stageLinks = (projectId: string, stage: StageId, extra: Array<{ label: string; href: string }> = []): ResultBlock => ({
  type: "links",
  links: [...extra, { label: `Open ${stageDef(stage).title}`, href: href.stage(projectId, stage) }],
});

function nextTitle(stage: StageId): string | undefined {
  const n = stageDef(stage).n;
  return STAGES.find((s) => s.n === n + 1)?.title;
}

/** The Ready for test note the Implementation gate sends: only when it was edited away from the shared draft. */
function readyForTestNote(b: ProjectBundle): string | undefined {
  const draft = readyForTestDraft(b);
  const note = b.project.stages.implementation.readyForTestNote ?? draft;
  return note !== draft && note.trim() ? note : undefined;
}

async function nameAndStage(projectId: string, stage: StageId | undefined, ctx: ToolContext) {
  return { name: await ctx.world.projectName(projectId), stage: await stageFor(projectId, stage, ctx) };
}

/** "123456", ".../pages/123456/Title" or "...?pageId=123456" → "123456". */
function confluencePageId(ref: string): string | undefined {
  const s = ref.trim();
  if (/^\d+$/.test(s)) return s;
  return /\/pages\/(\d+)/.exec(s)?.[1] ?? /[?&]pageId=(\d+)/.exec(s)?.[1];
}

/** The first "# " heading, without the "BRD:" / "Architecture Approach -" prefix (as the import dialog titles it). */
function firstHeading(markdown: string): string | undefined {
  const m = /^#\s+(.+)$/m.exec(markdown);
  return m?.[1]?.replace(/^(BRD:|Architecture Approach\s*-)\s*/i, "").trim() || undefined;
}

async function approveSummary(projectId: string, stage: StageId, ctx: ToolContext): Promise<string> {
  const name = await ctx.world.projectName(projectId);
  if (stage === "signoff") return `Sign off ${name}`;
  const next = nextTitle(stage);
  return `Approve ${stageDef(stage).title} of ${name}${next ? ` and move to ${next}` : ""}`;
}

/** The gate as its approve dialog shows it: blockers, the warnings confirming acknowledges, what happens next. */
async function approvePreview(projectId: string, stage: StageId, ctx: ToolContext): Promise<ResultBlock[]> {
  const b = await ctx.world.project(projectId);
  const view = b.stages[stage];
  const title = stageDef(stage).title;
  const blocks: ResultBlock[] = [];
  if (view.status === "approved") blocks.push({ type: "text", tone: "attention", text: `${title} is already approved.` });
  else if (view.status === "locked") blocks.push({ type: "text", tone: "attention", text: `${title} is locked until the stage before it is approved.` });
  if (view.blockers.length) {
    blocks.push({ type: "text", tone: "danger", text: `${title} can't be approved yet. Resolve ${view.blockers.length === 1 ? "this blocker" : `these ${view.blockers.length} blockers`} first:` });
    blocks.push({ type: "items", items: blockerItems(b, stage) });
  }
  if (view.warnings.length) {
    blocks.push({ type: "text", tone: "attention", text: `Confirming acknowledges ${view.warnings.length === 1 ? "this warning" : `these ${view.warnings.length} warnings`}, as ticking them at the gate does:` });
    blocks.push({ type: "items", items: view.warnings.map((w) => ({ title: w })) });
  }
  shownWarnings.set(`${projectId}/${stage}`, view.warnings);
  const next = nextTitle(stage);
  blocks.push({
    type: "text",
    text:
      stage === "signoff"
        ? "Signing off marks the project done and makes it read-only. Your name and the time are recorded."
        : stage === "implementation"
          ? `This approves Implementation and moves the project to ${next}. QA starts from the Ready for test note${readyForTestNote(b) ? " you edited" : ", written from the approved tasks"}.`
          : `This approves ${title}${next ? ` and moves the project to ${next}` : ""}. Your name and the time are recorded.`,
  });
  return blocks;
}

/** Why a gate can't be approved right now, as its disabled button would say. */
async function approveBlocked(projectId: string, stage: StageId, ctx: ToolContext): Promise<string | undefined> {
  const view = (await ctx.world.project(projectId)).stages[stage];
  const title = stageDef(stage).title;
  if (view.status === "approved") return `${title} is already approved.`;
  if (view.status === "locked") return `${title} is locked until the stage before it is approved.`;
  if (view.blockers.length) return `Confirm unlocks once ${view.blockers.length === 1 ? "the blocker is" : `all ${view.blockers.length} blockers are`} resolved; ask me again then.`;
  return undefined;
}

/** Approve a gate the way its dialog does once every warning is ticked. */
async function approve(projectId: string, stage: StageId, comment: string | undefined, ctx: ToolContext): Promise<ToolResult> {
  const b = await ctx.world.project(projectId);
  const warnings = b.stages[stage].warnings;
  const shown = shownWarnings.get(`${projectId}/${stage}`);
  const unseen = shown ? warnings.filter((w) => !shown.includes(w)) : [];
  if (unseen.length) throw new Error(`New ${unseen.length === 1 ? "warning" : "warnings"} since you asked: ${unseen.join("; ")}. Ask me to approve again to review ${unseen.length === 1 ? "it" : "them"}.`);
  const note = stage === "implementation" ? readyForTestNote(b) : undefined;
  const body: DecisionBody = {
    decision: "approved",
    ...(comment?.trim() ? { comment: comment.trim() } : {}),
    ...(warnings.length ? { acknowledgedWarnings: warnings } : {}),
    ...(note ? { readyForTestNote: note } : {}),
  };
  await delivery.decideStage(projectId, stage, body);
  shownWarnings.delete(`${projectId}/${stage}`);
  ctx.invalidate(projectId);
  const next = STAGES.find((x) => x.n === stageDef(stage).n + 1);
  return {
    text: `${APPROVED_TEXT[stage]}.${warnings.length ? ` ${plural(warnings.length, "warning")} acknowledged.` : ""}`,
    blocks: [next ? stageLinks(projectId, next.id) : { type: "links", links: [{ label: "Project overview", href: href.project(projectId) }] }],
  };
}

/** Stages and gates: starting each stage's run, importing documents, approving, requesting changes, reopening. */
export const stagesTools = [
  defineTool({
    name: "start_requirements",
    group: "stages",
    title: "Start the requirements run",
    description: "Start the po-brd run (Stage 1) from the project's saved intake: it searches Jira and Confluence, asks to confirm dependencies, then drafts the BRD for review.",
    effect: "write",
    params: { projectId: { kind: "project", description: "The project" } },
    utterances: [
      "(start|run|kick off|begin|launch|rerun) [the] (requirements|brd|po-brd) [run|stage|workflow] (for|on|of|in) [the] [project] {projectId}",
      "(start|run|kick off|begin|launch|rerun) [the] (requirements|brd|po-brd) [run|stage|workflow]",
      "(start|run|kick off|begin|launch|rerun) po-brd (for|on) [the] [project] {projectId}",
      "(draft|write|generate) [the|a] brd (for|of) [the] [project] {projectId}",
      "(draft|write|generate) [the|a] brd",
    ],
    examples: ["Start the requirements run for {project}", "Kick off the BRD"],
    covers: ["delivery.startRequirements"],
    summary: async ({ projectId }, ctx) => `Start the po-brd run for ${await ctx.world.projectName(projectId)}`,
    preview: async ({ projectId }, ctx) => {
      const { intake } = (await ctx.world.project(projectId)).project;
      const notes = intake.sources.filter((s) => s.mapsTo === "notes").length;
      const blocks: ResultBlock[] = [
        {
          type: "facts",
          facts: [
            { label: "Request", value: intake.request.trim() ? clip(intake.request, 240) : "none" },
            { label: "Sources", value: `${plural(intake.sources.length - notes, "Jira/Confluence seed")}, ${plural(notes, "note")}` },
            { label: "Review rounds", value: String(intake.options.maxRounds) },
          ],
        },
      ];
      if (!intake.request.trim() && !notes) blocks.push({ type: "text", tone: "attention", text: "The intake has no request or notes yet, so po-brd will refuse to start. Set the request first." });
      return blocks;
    },
    run: async ({ projectId }, ctx) => {
      const { runId } = await delivery.startRequirements(projectId);
      ctx.invalidate(projectId);
      return {
        text: "po-brd run started. It searches Jira & Confluence first, then asks you to confirm the dependencies it found.",
        blocks: [stageLinks(projectId, "requirements", [{ label: `Run ${runId}`, href: href.run(runId) }])],
      };
    },
  }),
  defineTool({
    name: "start_architecture",
    group: "stages",
    title: "Start the architecture run",
    description:
      "Start the architect-aad run (Stage 2) from the accepted BRD and the stage's saved request, sources and run options, as the Architecture brief does. An optional request replaces the saved one.",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      request: { kind: "text", description: "What the architecture should cover (default: the saved request)", required: false },
    },
    utterances: [
      "(start|run|kick off|begin|launch|rerun) [the] (architecture|aad|architect-aad|architect) [run|stage|workflow] (for|on|of|in) [the] [project] {projectId}",
      "(start|run|kick off|begin|launch|rerun) [the] (architecture|aad|architect-aad|architect) [run|stage|workflow]",
      "(start|run|kick off|begin|launch) [the] (architecture|aad|architect-aad) [run] (for|on|of) [the] [project] {projectId} (with [the] request|asking for|to cover) {request}",
      "(draft|write|generate) [the|an] aad (for|of) [the] [project] {projectId}",
      "(draft|write|generate) [the|an] aad",
    ],
    examples: ["Start the architecture run for {project}", "Generate the AAD"],
    covers: ["delivery.startArchitecture"],
    summary: async ({ projectId }, ctx) => `Start the architect-aad run for ${await ctx.world.projectName(projectId)}`,
    preview: async ({ projectId, request }, ctx) => {
      const b = await ctx.world.project(projectId);
      const rec = b.project.stages.architecture;
      const brd = docOf(b, "brd");
      const req = (request ?? rec.request ?? "").trim();
      const blocks: ResultBlock[] = [
        {
          type: "facts",
          facts: [
            { label: "BRD", value: brd ? `v${brd.versions.at(-1)?.n ?? brd.versions.length} ${brd.status}` : "no accepted BRD" },
            { label: "Request", value: req ? clip(req, 240) : "none (the BRD is the input)" },
            { label: "Extra sources", value: String((rec.sources ?? []).length) },
            { label: "Budget", value: rec.options?.budget || DEFAULT_AAD_OPTIONS.budget || "" },
          ],
        },
      ];
      if (brd?.status !== "accepted") blocks.push({ type: "text", tone: "attention", text: "There is no accepted BRD; architect-aad then needs a request or notes to start." });
      return blocks;
    },
    run: async ({ projectId, request }, ctx) => {
      const rec = (await ctx.world.project(projectId)).project.stages.architecture;
      const body: StartArchitectureBody = {
        request: (request ?? rec.request ?? "").trim(),
        sources: rec.sources ?? [],
        options: { ...DEFAULT_AAD_OPTIONS, ...rec.options, budget: rec.options?.budget?.trim() || DEFAULT_AAD_OPTIONS.budget },
      };
      const { runId } = await delivery.startArchitecture(projectId, body);
      ctx.invalidate(projectId);
      return {
        text: "architect-aad run started. It searches Jira & Confluence, then drafts the AAD for your review.",
        blocks: [stageLinks(projectId, "architecture", [{ label: `Run ${runId}`, href: href.run(runId) }])],
      };
    },
  }),
  defineTool({
    name: "start_implementation_plan",
    group: "stages",
    title: "Generate the implementation plan",
    description: "Start the dev-plan run (Stage 3): it reads the accepted BRD and AAD, shared memory, the accepted epics and developer notes, and proposes tasks in waves for review.",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      notes: { kind: "text", description: "Extra notes for the planner", required: false },
    },
    utterances: [
      "(generate|create|draft|make|write) [the|an] (implementation plan|plan|dev plan|dev-plan) (for|of) [the] [project] {projectId}",
      "(generate|create|draft|make|write) [the|an] (implementation plan|plan|dev plan|dev-plan)",
      "generate [the] tasks (for|of) [the] [project] {projectId}",
      "generate [the] tasks",
      "(start|run|kick off|begin|launch|rerun) [the] (planning|dev-plan|plan|implementation plan|implementation planning) [run|stage] (for|on|of|in) [the] [project] {projectId}",
      "(start|run|kick off|begin|launch|rerun) [the] (planning|dev-plan|plan|implementation plan|implementation planning) [run|stage]",
      "(generate|create|make) [the] (implementation plan|plan) (for|of) [the] [project] {projectId} (noting|with [the] notes|with [the] note) {notes}",
    ],
    examples: ["Generate the implementation plan for {project}", "Start the dev-plan run"],
    covers: ["delivery.startPlan"],
    summary: async ({ projectId }, ctx) => `Start the dev-plan run for ${await ctx.world.projectName(projectId)}`,
    preview: async ({ projectId }, ctx) => {
      const b = await ctx.world.project(projectId);
      const missing = [docOf(b, "brd")?.status === "accepted" ? null : "an accepted BRD", docOf(b, "aad")?.status === "accepted" ? null : "an accepted AAD"].filter(Boolean);
      const notes = b.project.stages.implementation.notes.filter((n) => !n.sentToRunId).length;
      const epics = b.epics.filter((e) => e.status !== "draft").length;
      const blocks: ResultBlock[] = [{ type: "text", text: `dev-plan reads ${plural(epics, "accepted epic")} and ${plural(notes, "new developer note")}, then proposes tasks in waves. Nothing starts until you approve the plan.` }];
      if (missing.length) blocks.push({ type: "text", tone: "attention", text: `Needs ${missing.join(" and ")} first.` });
      return blocks;
    },
    run: async ({ projectId, notes }, ctx) => {
      const { runId } = await delivery.startPlan(projectId, notes?.trim() ? { notes: notes.trim() } : {});
      ctx.invalidate(projectId);
      return { text: "dev-plan run started: generating the plan.", blocks: [stageLinks(projectId, "implementation", [{ label: `Run ${runId}`, href: href.run(runId) }])] };
    },
  }),
  defineTool({
    name: "import_document",
    group: "stages",
    title: "Import a BRD or AAD",
    description: "Import pasted markdown as the project's BRD (Requirements) or AAD (Architecture) instead of running its workflow. It is accepted as a new version; epics are proposed from it.",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      stage: DOC_STAGE,
      content: { kind: "text", description: "The document's markdown", ask: "Paste the document's markdown." },
      title: { kind: "text", description: "Title (default: its first heading)", required: false },
    },
    utterances: [
      "(import|paste|upload|add) [a|an|the|my] [existing] {stage} [document|doc|markdown] (for|into|to|in|on) [the] [project] {projectId}",
      "(import|paste|upload) [a|an|the|my] [existing] {stage} [document|doc|markdown]",
      "import [a|an] [existing] (document|doc)",
    ],
    examples: ["Import an existing BRD for {project}", "Paste the AAD"],
    covers: ["delivery.importDoc"],
    summary: async ({ projectId, stage }, ctx) => `Import the ${DOC_OF[stage]} of ${await ctx.world.projectName(projectId)} from pasted markdown`,
    preview: ({ stage, content, title }) => {
      const expected = stage === "requirements" ? /^#\s+BRD:/m : /^#\s+Architecture Approach/m;
      const blocks: ResultBlock[] = [
        {
          type: "facts",
          facts: [
            { label: "Document", value: `${DOC_OF[stage]} (${stageDef(stage).title})` },
            { label: "Title", value: title?.trim() || firstHeading(content) || "from the project" },
            { label: "Length", value: plural(content.split("\n").length, "line") },
          ],
        },
      ];
      if (!expected.test(content)) blocks.push({ type: "text", tone: "attention", text: `This doesn't start with “# ${stage === "requirements" ? "BRD: …" : "Architecture Approach - …"}”, so it may not be a ${DOC_OF[stage]}.` });
      return blocks;
    },
    run: async ({ projectId, stage, content, title }, ctx) => {
      const heading = firstHeading(content);
      const body: ImportBody = { content, source: "paste", ...(title?.trim() || heading ? { title: title?.trim() || heading } : {}) };
      await delivery.importDoc(projectId, stage, body);
      ctx.invalidate(projectId);
      return { text: `${DOC_OF[stage]} imported. Next: accept the proposed epics and approve ${stageDef(stage).title}.`, blocks: [stageLinks(projectId, stage)] };
    },
  }),
  defineTool({
    name: "import_confluence_page",
    group: "stages",
    title: "Import a BRD or AAD from Confluence",
    description: "Import a Confluence page (by page id or URL) as the project's BRD (Requirements) or AAD (Architecture) instead of running its workflow.",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      stage: DOC_STAGE,
      page: { kind: "text", description: "Confluence page id or URL", ask: "Which Confluence page? Its id (digits) or its URL." },
      title: { kind: "text", description: "Title (default: the page's)", required: false },
    },
    utterances: [
      "import [the] {stage} [document|doc] from confluence [page] {page} (for|into|to|in) [the] [project] {projectId}",
      "import [the] {stage} [document|doc] from confluence [page] {page}",
      "import [the] {stage} [document|doc] from confluence",
      "import [a|the] confluence page {page} as [the|a|an] {stage} [document|doc]",
    ],
    examples: ["Import the BRD from Confluence page 48213377"],
    covers: ["delivery.importDoc"],
    summary: async ({ projectId, stage, page }, ctx) => `Import Confluence page ${confluencePageId(page) ?? page} as the ${DOC_OF[stage]} of ${await ctx.world.projectName(projectId)}`,
    run: async ({ projectId, stage, page, title }, ctx) => {
      const pageId = confluencePageId(page);
      if (!pageId) throw new Error("Give a Confluence page id (digits) or a page URL containing /pages/<id> or ?pageId=<id>.");
      await delivery.importDoc(projectId, stage, { content: "", source: "confluence", ref: pageId, ...(title?.trim() ? { title: title.trim() } : {}) });
      ctx.invalidate(projectId);
      return { text: `${DOC_OF[stage]} imported from Confluence page ${pageId}. Next: accept the proposed epics and approve ${stageDef(stage).title}.`, blocks: [stageLinks(projectId, stage)] };
    },
  }),
  defineTool({
    name: "approve_stage",
    group: "stages",
    title: "Approve a stage gate",
    description:
      "Approve a stage's gate and move the project to the next stage (at PO Review: sign off, which marks the project done). Fails while the gate has blockers; confirming acknowledges the gate's warnings. Without a stage, the page's or the current one.",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      stage: { kind: "stage", description: "The stage", required: false, fromPage: false },
      comment: { kind: "text", description: "Comment", required: false },
    },
    utterances: [
      "(approve|accept|sign off on|sign off|pass|ok) [the] {stage} [stage|gate] (of|for|on|in) [the] [project] {projectId}",
      "(approve|accept|sign off on|sign off|pass|ok) [the] {stage} [stage|gate] (of|for|on|in) [the] [project] {projectId} (with [the] comment|saying|commenting) {comment}",
      "(approve|accept|sign off on|pass) [the] {stage} (stage|gate)",
      "(approve|accept|sign off on|pass) [the] {stage} (stage|gate) (with [the] comment|saying|commenting) {comment}",
      "(approve|accept|pass) [the] (current|open) (stage|gate) [of|for|on] [the] [project] {projectId}",
      "(approve|accept|pass) [the] (current|open) (stage|gate)",
    ],
    examples: ["Approve the requirements stage of {project}", "Approve the current stage"],
    covers: ["delivery.decideStage"],
    summary: async ({ projectId, stage }, ctx) => approveSummary(projectId, await stageFor(projectId, stage, ctx), ctx),
    preview: async ({ projectId, stage }, ctx) => approvePreview(projectId, await stageFor(projectId, stage, ctx), ctx),
    blocked: async ({ projectId, stage }, ctx) => approveBlocked(projectId, await stageFor(projectId, stage, ctx), ctx),
    run: async ({ projectId, stage, comment }, ctx) => approve(projectId, await stageFor(projectId, stage, ctx), comment, ctx),
  }),
  defineTool({
    name: "hand_off_to_qa",
    group: "stages",
    title: "Hand off to QA",
    description: "Approve the Implementation gate and move the project to QA Certification, with the Ready for test note written from the approved tasks.",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      comment: { kind: "text", description: "Comment", required: false },
    },
    utterances: ["(hand off|handoff|hand over|send) [the] [project] {projectId} to qa", "(hand off|handoff|hand over) to qa", "(hand off|handoff|hand over) [the] [project] {projectId}"],
    examples: ["Hand off {project} to QA"],
    covers: ["delivery.decideStage"],
    summary: ({ projectId }, ctx) => approveSummary(projectId, "implementation", ctx),
    preview: ({ projectId }, ctx) => approvePreview(projectId, "implementation", ctx),
    blocked: ({ projectId }, ctx) => approveBlocked(projectId, "implementation", ctx),
    run: ({ projectId, comment }, ctx) => approve(projectId, "implementation", comment, ctx),
  }),
  defineTool({
    name: "sign_off_project",
    group: "stages",
    title: "Sign off a project",
    description: "Approve the PO Review gate: the project is marked done and becomes read-only.",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      comment: { kind: "text", description: "Comment", required: false },
    },
    utterances: ["(sign off|signoff|sign-off) [on] [the] [project] {projectId}", "(sign off|signoff|sign-off) [on] (it|this|the project|this project)", "(mark|set) [the] [project] {projectId} (as done|done)"],
    examples: ["Sign off on {project}"],
    covers: ["delivery.decideStage"],
    summary: ({ projectId }, ctx) => approveSummary(projectId, "signoff", ctx),
    preview: ({ projectId }, ctx) => approvePreview(projectId, "signoff", ctx),
    blocked: ({ projectId }, ctx) => approveBlocked(projectId, "signoff", ctx),
    run: ({ projectId, comment }, ctx) => approve(projectId, "signoff", comment, ctx),
  }),
  defineTool({
    name: "request_changes",
    group: "stages",
    title: "Request changes at a stage gate",
    description:
      "Record a change request on a stage's gate with a required comment; the stage stays open and no agent work starts. At PO Review, send the project back to an earlier stage instead (reopen_stage).",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      stage: { kind: "stage", description: "The stage", required: false, fromPage: false },
      comment: { kind: "text", description: "What needs to change", ask: "What needs to change?" },
    },
    utterances: [
      "(request|ask for) changes (to|on|for|in) [the] {stage} [stage|gate] (of|for|on|in) [the] [project] {projectId}",
      "(request|ask for) changes (to|on|for|in) [the] {stage} [stage|gate] (of|for|on|in) [the] [project] {projectId} (saying|because|with [the] comment) {comment}",
      "(request|ask for) changes (to|on|for|in) [the] {stage} [stage|gate]",
      "(request|ask for) changes (to|on|for|in) [the] {stage} [stage|gate] (saying|because|with [the] comment) {comment}",
      "(request|ask for) changes",
      "(request|ask for) changes (saying|because|with [the] comment) {comment}",
      "reject [the] {stage} (stage|gate) [of|for|on|in] [the] [project] {projectId}",
      "reject [the] {stage} (stage|gate)",
    ],
    examples: ["Request changes to the architecture stage of {project}", "Request changes because the export misses inactive ambassadors"],
    covers: ["delivery.decideStage"],
    summary: async ({ projectId, stage, comment }, ctx) => {
      const { name, stage: s } = await nameAndStage(projectId, stage, ctx);
      return `Request changes to ${stageDef(s).title} of ${name}: “${clip(comment, 80)}”`;
    },
    preview: async ({ projectId, stage }, ctx) => {
      const s = await stageFor(projectId, stage, ctx);
      if (s === "signoff") return [{ type: "text", tone: "attention", text: "PO Review sends work back by reopening an earlier stage; say “send it back to QA because …”." }];
      return [{ type: "text", text: `This records your comment and keeps ${stageDef(s).title} open; it doesn't start any agent work. ${REWORK_ROUTE[s] ?? ""}`.trim() }];
    },
    run: async ({ projectId, stage, comment }, ctx) => {
      const s = await stageFor(projectId, stage, ctx);
      if (s === "signoff") throw new Error("At PO Review, changes go back to an earlier stage: ask me to send the project back to that stage, with the reason.");
      await delivery.decideStage(projectId, s, { decision: "changes_requested", comment: comment.trim() });
      ctx.invalidate(projectId);
      return { text: `Change request recorded on ${stageDef(s).title}. ${REWORK_ROUTE[s] ?? ""}`.trim(), blocks: [stageLinks(projectId, s)] };
    },
  }),
  defineTool({
    name: "reopen_stage",
    group: "stages",
    title: "Reopen a stage",
    description: "Reopen an approved stage with a required reason (PO Review's Send back): it loses its approval and becomes current again; later stages keep their data but are marked stale.",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      stage: { kind: "stage", description: "The stage to reopen" },
      comment: { kind: "text", description: "Why it is reopened", ask: "Why are you reopening it?" },
    },
    utterances: [
      "reopen [the] {stage} [stage] (of|for|on|in) [the] [project] {projectId}",
      "reopen [the] {stage} [stage] (of|for|on|in) [the] [project] {projectId} (because|saying|with [the] comment) {comment}",
      "reopen [the] {stage} [stage]",
      "reopen [the] {stage} [stage] (because|saying|with [the] comment) {comment}",
      "send [the] [project] {projectId} back to [the] {stage} [stage]",
      "send [the] [project] {projectId} back to [the] {stage} [stage] (because|saying|with [the] comment) {comment}",
      "send [it] back to [the] {stage} [stage]",
      "send [it] back to [the] {stage} [stage] (because|saying|with [the] comment) {comment}",
    ],
    examples: ["Reopen the requirements stage of {project}", "Send it back to QA"],
    covers: ["delivery.reopenStage"],
    summary: async ({ projectId, stage, comment }, ctx) => `Reopen ${stageDef(stage).title} of ${await ctx.world.projectName(projectId)}: “${clip(comment, 80)}”`,
    preview: ({ stage }) => {
      const later = STAGES.filter((s) => s.n > stageDef(stage).n);
      return [
        {
          type: "text",
          text: `${stageDef(stage).title} loses its approval and becomes the current stage again.${later.length ? ` ${later.map((s) => s.title).join(", ")} keep their data but are marked stale and locked until it is approved again.` : ""}`,
        },
      ];
    },
    run: async ({ projectId, stage, comment }, ctx) => {
      await delivery.reopenStage(projectId, stage, { comment: comment.trim() });
      ctx.invalidate(projectId);
      return { text: `${stageDef(stage).title} reopened.`, blocks: [stageLinks(projectId, stage)] };
    },
  }),
  defineTool({
    name: "stage_status",
    group: "stages",
    title: "Show what a stage needs",
    description: "What is blocking or needed at a stage's gate: its status, blockers (with links to where each is resolved), warnings to acknowledge, pending requests and the next step.",
    effect: "read",
    params: {
      projectId: { kind: "project", description: "The project" },
      stage: { kind: "stage", description: "The stage (default: the page's or the current one)", required: false, fromPage: false },
    },
    utterances: [
      "(what's|what is|whats) blocking (this|the current|the) (stage|gate)",
      "(what's|what is|whats) blocking [the] {stage} (stage|gate)",
      "(what's|what is|whats) blocking [the] {stage} [stage|gate] (of|for|on|in) [the] [project] {projectId}",
      "(what's|what is|whats) blocking [the] [project] {projectId}",
      "(what's|what is|whats) (blocking|left|needed|missing) [here|now]",
      "(what's|what is|whats) (needed|left|missing) (for|on|in|at) [the] {stage} [stage|gate] (of|for|on|in) [the] [project] {projectId}",
      "(what's|what is|whats) (needed|left|missing) (for|on|in|at) [the] {stage} [stage|gate]",
      "why (can't|cant|can not) i approve [the] {stage} [stage|gate]",
      "why is [the] {stage} (stage|gate) (blocked|stuck)",
      "why is [the] [project] {projectId} (blocked|stuck)",
      "(show|what are) [the] (blockers|warnings) (for|on|of|at) [the] {stage} [stage|gate]",
    ],
    examples: ["What's blocking this stage?", "What's needed for the QA stage of {project}?", "Why is {project} stuck?"],
    covers: ["delivery.project"],
    summary: async ({ projectId, stage }, ctx) => {
      const { name, stage: s } = await nameAndStage(projectId, stage, ctx);
      return `Show what ${stageDef(s).title} of ${name} needs`;
    },
    run: async ({ projectId, stage }, ctx) => {
      const b = await ctx.world.project(projectId);
      const s = await stageFor(projectId, stage, ctx);
      const view = b.stages[s];
      const title = stageDef(s).title;
      const status = stageStatusMeta(view.status);
      const nextStep = b.nextStep && b.nextStep.stage === s ? b.nextStep : undefined;
      const blocks: ResultBlock[] = [
        {
          type: "facts",
          title: `${title} · ${b.project.name}`,
          facts: [
            { label: "Status", value: status.label },
            ...(view.metric ? [{ label: "Progress", value: view.metric }] : []),
            ...(view.pending ? [{ label: "Pending requests", value: String(view.pending) }] : []),
            ...(nextStep ? [{ label: "Next step", value: nextStep.text, href: nextStep.href }] : []),
          ],
        },
      ];
      const open = view.status !== "approved";
      if (open && view.blockers.length) blocks.push({ type: "items", title: "Blockers", items: blockerItems(b, s) });
      if (open && view.warnings.length) blocks.push({ type: "items", title: "Warnings to acknowledge at the gate", items: view.warnings.map((w) => ({ title: w })) });
      blocks.push(stageLinks(projectId, s, nextStep ? [{ label: "Go to the next step", href: nextStep.href }] : []));
      const text =
        view.status === "approved"
          ? `${title} of ${b.project.name} is approved.`
          : view.status === "locked"
            ? `${title} of ${b.project.name} is locked until the stage before it is approved.`
            : view.blockers.length
              ? `${title} of ${b.project.name}: ${status.label.toLowerCase()}, with ${plural(view.blockers.length, "blocker")}${view.warnings.length ? ` and ${plural(view.warnings.length, "warning")}` : ""}.`
              : `Nothing blocks the ${title} gate of ${b.project.name}${view.warnings.length ? `; approving acknowledges ${plural(view.warnings.length, "warning")}` : ""}.`;
      return { text, blocks };
    },
  }),
] as const;
