import { delivery } from "@/lib/api/client";
import type { ChangeReview, DeliveryTask, ProjectBundle, TraceRow } from "@/lib/delivery/types";
import { plural } from "@/lib/format";
import { qaStatusMeta, traceVerdictMeta } from "@/lib/weft/labels";
import { defineTool } from "../define";
import type { ResultBlock, ResultItem, ToolContext } from "../types";
import { actorLabel, clip, href, pill, taskTitle } from "./projects";

const qaHref = (projectId: string, step?: "tasks" | "traceability" | "changes") => href.stage(projectId, "qa", step);

/** Tasks a QA start picks, as the server does: the named one, or every done task not yet tested (or blocked). */
function qaTargets(b: ProjectBundle, taskId?: string): DeliveryTask[] {
  if (taskId) return b.tasks.filter((t) => t.id === taskId);
  return b.tasks.filter((t) => t.status === "done" && (t.qa.status === "pending" || t.qa.status === "blocked"));
}

function traceItem(projectId: string, r: TraceRow): ResultItem {
  return {
    title: `${r.brRef} · ${clip(r.brText, 90)}`,
    subtitle: [r.frRefs.length ? r.frRefs.join(", ") : null, r.taskIds.length ? `tasks ${r.taskIds.join(", ")}` : "no tasks", r.waiver?.comment ? `waived: ${clip(r.waiver.comment, 60)}` : null].filter(Boolean).join(" · "),
    meta: plural(r.evidenceCount, "evidence item"),
    href: qaHref(projectId, "traceability"),
    status: pill(traceVerdictMeta(r.verdict)),
  };
}

const changeStatus = (c: ChangeReview): NonNullable<ResultItem["status"]> =>
  c.consistent === undefined ? { label: "Not reviewed", tone: "attention" } : c.consistent ? { label: "Consistent", tone: "success" } : { label: "Not consistent", tone: "danger" };

function changeItem(projectId: string, c: ChangeReview): ResultItem {
  return {
    title: `${c.label} (${c.kind})`,
    subtitle: [clip(c.summary, 100), c.by ? `reviewed by ${actorLabel(c.by)}` : null, c.comment ? `“${clip(c.comment, 60)}”` : null].filter(Boolean).join(" · "),
    meta: c.files !== undefined ? `${plural(c.files, "file")}${c.adds !== undefined ? ` +${c.adds} −${c.dels ?? 0}` : ""}` : undefined,
    href: qaHref(projectId, "changes"),
    status: changeStatus(c),
  };
}

async function changeLabel(projectId: string, changeId: string, ctx: ToolContext): Promise<string> {
  return (await ctx.world.project(projectId)).changeReviews.find((c) => c.id === changeId)?.label ?? changeId;
}

/** QA: starting qa-verify runs, the requirements trace and its waivers, the change reviews. */
export const qaTools = [
  defineTool({
    name: "start_qa",
    group: "qa",
    title: "Start QA",
    description: "Start qa-verify runs (Stage 4) for every done task not yet tested, or for one task. Needs Implementation to be approved.",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      taskId: { kind: "task", description: "Only this task", required: false },
    },
    utterances: [
      "(start|run|kick off|begin|launch) [the] (qa|testing|tests|qa certification|verification|qa-verify) [run|runs|stage]",
      "(start|run|kick off|begin|launch) [the] (qa|testing|tests|qa certification|verification|qa-verify) [run|runs|stage] (for|on|of|in) [the] [project] {projectId}",
      "(start|run|kick off|begin|launch) (qa|testing|tests|verification) (for|on|of) [the] task {taskId}",
      "(test|verify|qa) [the] task {taskId}",
      "(test|verify|qa) [the] task {taskId} (in|for|of|on) [the] [project] {projectId}",
    ],
    examples: ["Start QA for {project}", "Test task T-2"],
    covers: ["delivery.startQa"],
    summary: async ({ projectId, taskId }, ctx) => {
      const name = await ctx.world.projectName(projectId);
      const t = taskId ? (await ctx.world.project(projectId)).tasks.find((x) => x.id === taskId) : undefined;
      return t ? `Start QA of ${t.id} · ${taskTitle(t.title)} in ${name}` : `Start QA for the untested tasks in ${name}`;
    },
    preview: async ({ projectId, taskId }, ctx) => {
      const b = await ctx.world.project(projectId);
      const targets = qaTargets(b, taskId);
      const blocks: ResultBlock[] = [];
      if (!b.project.stages.implementation.approvedAt) blocks.push({ type: "text", tone: "attention", text: "QA starts once Implementation is approved." });
      blocks.push({
        type: "items",
        title: targets.length ? plural(targets.length, "task") : undefined,
        items: targets.map((t) => ({ title: `${t.id} · ${taskTitle(t.title)}`, subtitle: t.jiraKey ?? undefined, href: href.task(projectId, t.id), status: pill(qaStatusMeta(t.qa.status)) })),
        empty: "No tasks are waiting for QA.",
      });
      return blocks;
    },
    blocked: async ({ projectId, taskId }, ctx) => {
      const b = await ctx.world.project(projectId);
      if (!b.project.stages.implementation.approvedAt) return "Confirm unlocks once Implementation is approved.";
      return qaTargets(b, taskId).length ? undefined : "Nothing to start: no task is waiting for QA.";
    },
    run: async ({ projectId, taskId }, ctx) => {
      const { runIds } = await delivery.startQa(projectId, taskId ? { taskIds: [taskId] } : {});
      ctx.invalidate(projectId);
      return {
        text: runIds.length ? `${plural(runIds.length, "QA run")} started.` : "No QA runs started; no task was eligible.",
        blocks: [{ type: "links", links: [...runIds.map((r) => ({ label: `Run ${r}`, href: href.run(r) })), { label: "Open QA Certification", href: qaHref(projectId, "tasks") }] }],
      };
    },
  }),
  defineTool({
    name: "traceability",
    group: "qa",
    title: "Show the requirements trace",
    description: "Each BRD requirement's QA verdict (met, missing, needs a manual check, waived) with the FRs, tasks and evidence behind it, and the counts.",
    effect: "read",
    params: { projectId: { kind: "project", description: "The project" } },
    utterances: [
      "(show|list|check|see) [me] [the] (traceability|trace|requirements trace|requirement trace) [matrix|report|table]",
      "(show|list|check|see) [me] [the] (traceability|trace|requirements trace|requirement trace) [matrix|report|table] (for|of|on|in) [the] [project] {projectId}",
      "(which|what) requirements are (met|missing|not met|uncovered|unmet|waived)",
      "(which|what) requirements are (met|missing|not met|uncovered|unmet|waived) (for|of|on|in) [the] [project] {projectId}",
      "(are|is) [all] [the] requirements met",
      "(are|is) [all] [the] requirements (met|covered) (for|of|on|in) [the] [project] {projectId}",
    ],
    examples: ["Show the traceability for {project}", "Which requirements are missing?"],
    covers: ["delivery.project"],
    summary: async ({ projectId }, ctx) => `Show the requirements trace of ${await ctx.world.projectName(projectId)}`,
    run: async ({ projectId }, ctx) => {
      const b = await ctx.world.project(projectId);
      const n = (v: TraceRow["verdict"]) => b.trace.filter((r) => r.verdict === v).length;
      const open = b.trace.length - n("met") - n("waived");
      return {
        text: !b.trace.length
          ? `${b.project.name} has no traced requirements yet; they come from the accepted BRD.`
          : open
            ? `${plural(open, "requirement")} of ${b.trace.length} still ${open === 1 ? "needs" : "need"} evidence or a waiver.`
            : `All ${plural(b.trace.length, "requirement")} are met or waived.`,
        blocks: [
          {
            type: "facts",
            facts: [
              { label: "Met", value: String(n("met")) },
              { label: "Missing", value: String(n("missing")) },
              { label: "Needs manual check", value: String(n("needs_manual_check")) },
              { label: "Waived", value: String(n("waived")) },
            ],
          },
          { type: "items", items: b.trace.map((r) => traceItem(projectId, r)), empty: "No requirements yet.", more: { label: "Open the traceability", href: qaHref(projectId, "traceability") } },
        ],
      };
    },
  }),
  defineTool({
    name: "waive_requirement",
    group: "qa",
    title: "Waive a requirement",
    description: "Waive one BRD requirement (BR-n) at QA, with a required comment saying why; it then counts as covered at the QA gate.",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      requirement: { kind: "requirement", description: "The requirement, e.g. BR-2" },
      comment: { kind: "text", description: "Why it is waived", ask: "Why is it waived?" },
    },
    utterances: [
      "waive [the] requirement {requirement}",
      "waive [the] requirement {requirement} (for|of|in|on) [the] [project] {projectId}",
      "waive [the] requirement {requirement} (because|saying|with [the] comment) {comment}",
      "waive [the] requirement {requirement} (for|of|in|on) [the] [project] {projectId} (because|saying|with [the] comment) {comment}",
      "waive {requirement}",
      "waive {requirement} (for|of|in|on) [the] [project] {projectId}",
      "waive {requirement} (for|of|in|on) [the] [project] {projectId} (because|saying|with [the] comment) {comment}",
      "waive {requirement} (because|saying|with [the] comment) {comment}",
    ],
    examples: ["Waive BR-3", "Waive the requirement BR-2 because legal dropped it"],
    covers: ["delivery.waiveTrace"],
    summary: async ({ projectId, requirement, comment }, ctx) => `Waive ${requirement} in ${await ctx.world.projectName(projectId)}: “${clip(comment, 80)}”`,
    preview: async ({ projectId, requirement }, ctx) => {
      const r = (await ctx.world.project(projectId)).trace.find((x) => x.brRef === requirement);
      return r ? [{ type: "items", items: [traceItem(projectId, r)] }] : [];
    },
    run: async ({ projectId, requirement, comment }, ctx) => {
      const row = await delivery.waiveTrace(projectId, requirement, { comment: comment.trim() });
      ctx.invalidate(projectId);
      return { text: "Requirement waived.", blocks: [{ type: "items", items: [traceItem(projectId, row)] }] };
    },
  }),
  defineTool({
    name: "list_change_reviews",
    group: "qa",
    title: "List the change reviews",
    description: "The code, memory and document changes QA must confirm are consistent with the requirements, and which are reviewed.",
    effect: "read",
    params: { projectId: { kind: "project", description: "The project" } },
    utterances: [
      "(show|list|see) [me] [the|all] change reviews",
      "(show|list|see) [me] [the|all] change reviews (for|of|on|in) [the] [project] {projectId}",
      "(show|list|see) [me] [the] changes to review",
      "(show|list|see) [me] [the] changes to review (for|of|on|in) [the] [project] {projectId}",
      "(which|what) changes (need|are waiting for|still need) [a] review",
    ],
    examples: ["Show the change reviews for {project}", "Which changes need review?"],
    covers: ["delivery.project"],
    summary: async ({ projectId }, ctx) => `List the change reviews of ${await ctx.world.projectName(projectId)}`,
    run: async ({ projectId }, ctx) => {
      const b = await ctx.world.project(projectId);
      const pending = b.changeReviews.filter((c) => c.consistent === undefined).length;
      return {
        text: !b.changeReviews.length
          ? `${b.project.name} has no changes to review yet; they appear once Implementation is handed off.`
          : pending
            ? `${plural(pending, "change")} of ${b.changeReviews.length} still ${pending === 1 ? "needs" : "need"} a review.`
            : `All ${plural(b.changeReviews.length, "change")} are reviewed.`,
        blocks: [{ type: "items", items: b.changeReviews.map((c) => changeItem(projectId, c)), empty: "No changes to review.", more: { label: "Open the change reviews", href: qaHref(projectId, "changes") } }],
      };
    },
  }),
  defineTool({
    name: "review_change",
    group: "qa",
    title: "Review a change",
    description: "Record whether a code, memory or document change is consistent with the requirements, with an optional comment.",
    effect: "write",
    params: {
      projectId: { kind: "project", description: "The project" },
      changeId: { kind: "change", description: "The change, by id (CR-1) or its repo or path" },
      consistent: { kind: "boolean", description: "Consistent with the requirements", ask: "Is it consistent with the requirements?" },
      comment: { kind: "text", description: "Comment", required: false },
    },
    utterances: [
      "(mark|flag|review) [the] change [review] {changeId} as {consistent}",
      "(mark|flag|review) [the] change [review] {changeId} (in|of|for|on) [the] project {projectId} as {consistent}",
      "(mark|flag|review) [the] change [review] {changeId} as {consistent} (because|saying|with [the] comment) {comment}",
      "(mark|flag) [the] {changeId} (change|changes) as {consistent}",
      "(mark|flag) [the] {changeId} (change|changes) as {consistent} (because|saying|with [the] comment) {comment}",
      "review [the] change [review] {changeId}",
      "(is|are) [the] change {changeId} {consistent}",
    ],
    examples: ["Mark the change CR-1 as consistent", "Review the change CR-2"],
    covers: ["delivery.reviewChange"],
    summary: async ({ projectId, changeId, consistent }, ctx) => `Mark ${await changeLabel(projectId, changeId, ctx)} as ${consistent ? "consistent" : "not consistent"} with the requirements`,
    preview: async ({ projectId, changeId }, ctx) => {
      const c = (await ctx.world.project(projectId)).changeReviews.find((x) => x.id === changeId);
      return c ? [{ type: "items", items: [changeItem(projectId, c)] }] : [];
    },
    run: async ({ projectId, changeId, consistent, comment }, ctx) => {
      const c = await delivery.reviewChange(projectId, changeId, { consistent, ...(comment?.trim() ? { comment: comment.trim() } : {}) });
      ctx.invalidate(projectId);
      return { text: `Recorded: ${c.label} is ${consistent ? "consistent" : "not consistent"} with the requirements.`, blocks: [{ type: "items", items: [changeItem(projectId, c)] }] };
    },
  }),
] as const;
