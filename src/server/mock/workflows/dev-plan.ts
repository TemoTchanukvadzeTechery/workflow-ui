import "server-only";
/**
 * dev-plan [SPEC]: turns the accepted BRD + AAD (+ developer notes and accepted epics) into a
 * wave-ordered task plan the developer approves or revises. Shaped like po-brd: Context reads the
 * documents, each Plan <round> drafts the plan, writes it to input.out (captured as a patch and
 * integrated), then waits on plan:review:<round>. Approve returns the tasks (the developer's edited
 * list wins), revise applies the feedback in the next round.
 */
import {
  PLAN_REVIEW_SCHEMA,
  type DevPlanInput,
  type DevPlanOutput,
  type PlannedTask,
  type PlanReport,
  type PlanReportExtras,
  type PlanReviewAnswer,
} from "@/lib/weft/workflows";
import { planPackFor, type PlanPack } from "@/server/mock/content/delivery";
import { changedSystems, reposOf } from "@/server/mock/content/delivery/generic-plan";
import type { DocContext } from "./delivery-lib/docs";
import type { MockWorkflow, ScriptCtx } from "../engine/api";
import { fileDiff } from "./delivery-lib/diff";
import { readDocs } from "./delivery-lib/docs";
import {
  parsePlanMarkdown,
  planQuestion,
  renderPlanMarkdown,
  renderPlanReport,
  resolveEpicId,
  sortTasks,
  tasksDiffer,
  waveCount,
} from "./delivery-lib/plan";
import { applyPlanFeedback } from "./delivery-lib/plan-revise";
import { devPlanInputSchema, devPlanOutputSchema, jsonSchema, parseDevPlanInput, validatePlannedTasks } from "./delivery-lib/schemas";
import { clip, plural, uniq } from "./delivery-lib/util";

const NOTE_FILE = /^[\w./-]+\.(md|txt)$/;

async function readStep(ctx: ScriptCtx<DevPlanInput>, path: string): Promise<string | undefined> {
  if (!path) return undefined;
  await ctx.step({
    kind: "fs",
    key: `read:${path}`,
    label: `read:${path}`,
    ms: 300,
    output: () => {
      const f = ctx.fs.read(path);
      return f ? { path, bytes: f.content.length, lines: f.content.split("\n").length, sha256: f.sha256 } : { path, missing: true };
    },
  });
  return ctx.fs.read(path)?.content;
}

function toTasks(pack: PlanPack, input: DevPlanInput): PlannedTask[] {
  return sortTasks(
    pack.tasks.map(({ epic, team, ...seed }) => {
      const task: PlannedTask = { ...seed, epicId: resolveEpicId(epic, input.epics, seed.traces), team: team ?? "Customer Guardians" };
      if (task.blockedBy === undefined) delete task.blockedBy;
      return task;
    }),
  );
}

type Report = PlanReport & PlanReportExtras;

/** AAD systems marked Proposed or changed with no task in their repository (or none mapped). */
function uncoveredSystems(docs: DocContext, tasks: readonly PlannedTask[], known: readonly string[] = []): string[] {
  const repos = new Set(tasks.map((t) => t.repo));
  const out = [...known];
  for (const system of changedSystems(docs)) {
    const mapped = reposOf([system]);
    if (!mapped.length || mapped.some((r) => repos.has(r)) || out.some((u) => u.startsWith(`${system}:`))) continue;
    out.push(`${system}: Proposed or changed in the AAD, but no task works on ${mapped.join(", ")}`);
  }
  return out;
}

/** The report with its extras refreshed for this task list. */
function withCoverage(report: Report, docs: DocContext, tasks: readonly PlannedTask[], notesNotApplied: readonly string[]): Report {
  const systems = uncoveredSystems(docs, tasks, (report.uncoveredSystems ?? []).filter((u) => /maps to no repository/.test(u)));
  const out: Report = { ...report };
  delete out.uncoveredSystems;
  delete out.notesNotApplied;
  if (systems.length) out.uncoveredSystems = systems;
  if (notesNotApplied.length) out.notesNotApplied = [...notesNotApplied];
  return out;
}

async function script(ctx: ScriptCtx<DevPlanInput>, input: DevPlanInput): Promise<DevPlanOutput> {
  // ---- Context -------------------------------------------------------------------------------
  ctx.phase("Context");
  const brd = await readStep(ctx, input.brd);
  const aad = await readStep(ctx, input.aad);
  const memory = await readStep(ctx, "memory/memory.md");
  const noteTexts: string[] = [];
  for (const note of input.notes) {
    if (NOTE_FILE.test(note.trim()) && ctx.fs.read(note.trim())) {
      const text = await readStep(ctx, note.trim());
      if (text) noteTexts.push(...text.split("\n").map((l) => l.replace(/^[-*]\s+/, "").trim()).filter((l) => l && !l.startsWith("#")));
    } else if (note.trim()) {
      noteTexts.push(note.trim());
    }
  }
  const docs = readDocs(brd, aad);
  const pack = planPackFor({ projectId: input.projectId, docs, epics: input.epics, notes: noteTexts });
  await ctx.step({
    kind: "agent",
    key: "context",
    label: "context",
    ms: 3000,
    usd: 0.4,
    output: {
      title: docs.title,
      requirements: docs.requirements.length,
      candidates: docs.requirements.filter((r) => r.candidate).map((r) => r.id),
      functionalRequirements: docs.frs.length,
      systemsChanged: docs.systems.filter((s) => !/no change|not used/i.test(s.change)).map((s) => s.system),
      openQuestions: docs.openQuestions.length,
      epics: input.epics.map((e) => e.key ?? e.title),
      notes: noteTexts.length,
      memoryFacts: (memory ?? "").split("\n").filter((l) => l.startsWith("- ")).length,
    },
  });
  ctx.log(
    `Context: ${docs.requirements.length} BRD requirements, ${docs.frs.length} AAD functional requirements, ${plural(input.epics.length, "epic")}, ${plural(noteTexts.length, "developer note")}`,
  );

  // Round 1 honours explicit instructions in the developer notes ("split T-6", "Q4: …", "T-5: …",
  // "… so the api-contracts change lands first"); other note text is not invented into acceptance
  // criteria but listed under "Notes not applied", so the developer can apply it by hand. A
  // hand-written pack already reflects its seeded notes, so those are recorded as assumptions.
  let tasks = toTasks(pack, input);
  let report: Report = pack.report;
  let changes = ["First plan."];
  const notesNotApplied: string[] = [];
  const reflected: string[] = [];
  for (const [i, note] of noteTexts.entries()) {
    const fromNote = applyPlanFeedback(tasks, report, note, [], { freeText: false });
    tasks = fromNote.tasks;
    report = { ...report, ...fromNote.report };
    changes.push(...fromNote.changes.map((c) => `${c} (developer note N${i + 1})`));
    const rest = fromNote.unapplied.join(" ").trim();
    if (!rest) continue;
    if (pack.curated) reflected.push(`Developer note N${i + 1}: ${clip(note, 160)}`);
    else notesNotApplied.push(`N${i + 1}: ${clip(rest, 200)} (no instruction the planner acts on; apply it to a task by hand, or rephrase it, e.g. "add AC to T-2: …", "T-3 depends on T-1")`);
  }
  report = withCoverage({ ...report, assumptions: [...report.assumptions, ...reflected] }, docs, tasks, notesNotApplied);

  // ---- Plan rounds ---------------------------------------------------------------------------
  for (let round = 1; round <= input.maxRounds; round++) {
    ctx.phase(`Plan ${round}`);
    const roundTasks = tasks;
    const roundReport = report;
    const roundChanges = changes;
    await ctx.step({
      kind: "agent",
      key: `plan:${round}`,
      label: `plan:${round}`,
      ms: 6000,
      usd: round === 1 ? 0.9 : 0.7,
      output: () => ({ tasks: roundTasks, report: roundReport, changes: roundChanges, waves: waveCount(roundTasks) }),
    });
    const markdown = renderPlanMarkdown({ title: docs.title, round, input, tasks: roundTasks, report: roundReport, changes: roundChanges, summary: pack.summary });
    const previous = ctx.fs.read(input.out)?.content;
    const diff = fileDiff(input.out, previous, markdown);
    if (diff) ctx.patch({ key: `plan:${round}`, files: [input.out], diff });
    await ctx.step({
      kind: "sideeffect",
      key: `integrate:plan:${round}`,
      label: `integrate:plan:${round}`,
      ms: 1000,
      status: "integrating",
      output: () => {
        const file = ctx.fs.write(input.out, markdown);
        if (diff) ctx.merge(`plan:${round}`);
        return { path: input.out, sha256: file.sha256, tasks: roundTasks.length, waves: waveCount(roundTasks) };
      },
    });
    ctx.note({
      kind: "claim",
      text: `${plural(roundTasks.length, "task")} in ${plural(waveCount(roundTasks), "wave")} trace ${uniq(roundTasks.flatMap((t) => t.traces).filter((r) => r.startsWith("BR"))).length} BRD requirements${
        roundReport.uncovered.length ? `; not covered: ${roundReport.uncovered.map((u) => u.split(/[\s:]/)[0]).join(", ")}` : ""
      }`,
      evidence: input.out,
    });

    const { answer, edited } = await ctx.review<PlanReviewAnswer>({
      key: `plan:review:${round}`,
      question: planQuestion(round, roundTasks, roundReport),
      schema: PLAN_REVIEW_SCHEMA,
      subject: { kind: "file", path: input.out, mode: "edit" },
      attachments: [
        { label: "plan report", mediaType: "text/markdown", content: renderPlanReport(roundReport, roundChanges) },
        { label: "tasks", mediaType: "application/json", content: JSON.stringify(roundTasks, null, 2) },
      ],
    });

    // The developer's structured edit wins, then a direct edit of the plan file, then the proposal.
    const fromAnswer = validatePlannedTasks(answer.tasks);
    if (answer.tasks !== undefined && !fromAnswer) ctx.log("plan:review answer carried an invalid task list; kept the proposal");
    const fromEdit = edited ? parsePlanMarkdown(edited.content, roundTasks) : undefined;
    const base = fromAnswer ?? fromEdit ?? roundTasks;
    const kept: string[] = [];
    if (fromAnswer && tasksDiffer(fromAnswer, roundTasks)) kept.push("Kept your edits to the task list");
    else if (fromEdit && tasksDiffer(fromEdit, roundTasks)) kept.push(`Kept your edits to ${input.out}`);

    if (answer.decision === "approve") {
      const start = answer.start ?? "all-waves";
      ctx.note({ kind: "decision", text: `Plan approved in round ${round}: ${plural(base.length, "task")} in ${plural(waveCount(base), "wave")}, start ${start}` });
      return { path: input.out, approved: true, rounds: round, tasks: sortTasks(base), start, report: withCoverage(roundReport, docs, base, roundReport.notesNotApplied ?? []) };
    }

    const revised = applyPlanFeedback(base, roundReport, answer.feedback ?? "", answer.newNotes ?? []);
    tasks = revised.tasks;
    report = withCoverage({ ...roundReport, ...revised.report }, docs, tasks, roundReport.notesNotApplied ?? []);
    changes = [...kept, ...revised.changes];
  }

  ctx.note({ kind: "decision", text: `Plan not approved after ${plural(input.maxRounds, "round")}; no tasks were created` });
  return { path: input.out, approved: false, rounds: input.maxRounds, tasks, start: "manual", report };
}

export const devPlan: MockWorkflow<DevPlanInput, DevPlanOutput> = {
  id: "dev-plan",
  description: "Plan implementation tasks from the accepted BRD and AAD, then have the developer approve the plan or ask for a revision.",
  file: ".weft/workflows/dev-plan/main.ts",
  input: jsonSchema(devPlanInputSchema),
  output: jsonSchema(devPlanOutputSchema, "output"),
  parseInput: parseDevPlanInput,
  defaults: { provider: "claude", model: "claude-opus-5", effort: "medium" },
  real: false,
  script,
};
