import "server-only";
/**
 * dev-task [SPEC]: one planned task, implemented by an agent on its branch and approved by the
 * developer. Phases: Prepare (git branch) -> Implement (agent, patch implement:<taskId>) -> Verify
 * (typecheck, lint, unit, contract|e2e; a failing check gets a fix:<n> agent and a re-run) ->
 * Integrate (merge) -> Review (task:review:<cycle>). request-changes runs "Rework <n>" and goes
 * round again; after maxReworkCycles the review is escalated (cancel offered). A QA loop-back run
 * (origin "qa") starts with "Rework from QA", applying the QA bugs to the existing branch.
 */
import type { CheckState, FileStat } from "@/lib/weft/types";
import {
  TASK_REVIEW_ESCALATED_SCHEMA,
  TASK_REVIEW_SCHEMA,
  type DevTaskInput,
  type DevTaskOutput,
  type ImplementStepOutput,
  type TaskReviewAnswer,
} from "@/lib/weft/workflows";
import { taskImplFor, type TaskImpl } from "@/server/mock/content/delivery";
import { genericRework } from "@/server/mock/content/delivery/templates";
import type { Fault } from "@/server/mock/content/delivery/types";
import type { MockWorkflow, ScriptCtx } from "../engine/api";
import { WorkingTree, diffStats, totals, type DiffTotals } from "./delivery-lib/diff";
import { devTaskInputSchema, devTaskOutputSchema, jsonSchema, parseDevTaskInput } from "./delivery-lib/schemas";
import { between, cell, clip, roundUsd, shortSha } from "./delivery-lib/util";
import { checkPlans, latestChecks, renderVerificationReport, runCheck } from "./delivery-lib/verify";

type Ctx = ScriptCtx<DevTaskInput>;

const SIZE_USD: Record<string, number> = { XS: 0.45, S: 0.65, M: 0.9, L: 1.15 };

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function implOutput(summary: string, tree: WorkingTree): ImplementStepOutput {
  const files: FileStat[] = diffStats(tree.diff());
  return { summary, files, diffStats: totals(files) };
}

/** Runs a step that may be configured to fail; the mock engine may reject or resolve. */
async function tolerant<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch {
    return undefined;
  }
}

interface RunState {
  tree: WorkingTree;
  impl: TaskImpl;
  checks: CheckState[];
  history: string[];
  summaries: string[];
  unmerged: string[];
  fixes: number;
}

function capture(ctx: Ctx, s: RunState, key: string, diff: string, files: string[]): void {
  if (!diff) return;
  ctx.patch({ key, files, diff });
  s.unmerged.push(key);
}

async function verify(ctx: Ctx, s: RunState, input: DevTaskInput, suffix: string, fault: Fault | undefined): Promise<void> {
  ctx.phase("Verify");
  const task = input.task;
  let pending = fault;
  for (const plan of checkPlans(task, s.impl, suffix)) {
    await ctx.gate(`bash: ${plan.def.command}`);
    const first = runCheck(task, s.impl, s.tree, plan, pending);
    await tolerant(
      ctx.step({
        kind: "check",
        key: plan.key,
        label: plan.label,
        ms: 1000,
        status: "verifying",
        output: first.output,
        ...(first.state.status === "fail" ? { fail: { code: "check_failed", message: first.state.summary ?? `${plan.def.name} failed` } } : {}),
      }),
    );
    ctx.check(first.state);
    s.checks.push(first.state);
    if (first.state.status === "pass" || !pending) continue;

    // A deliberate first-attempt defect: an agent fixes it and the check runs again.
    const f: Fault = pending;
    pending = undefined;
    s.fixes += 1;
    const n = s.fixes;
    const snap = s.tree.snapshot();
    s.tree.replace(f.path, f.broken, f.correct);
    await ctx.step({
      kind: "agent",
      key: `fix:${n}`,
      label: `fix:${n} · ${plan.label} in ${basename(f.path)}`,
      ms: 3000,
      usd: 0.3,
      status: "executing",
      output: () => ({ summary: f.fixSummary, check: plan.def.name, files: diffStats(s.tree.diffSince(snap)) }),
    });
    capture(ctx, s, `fix:${n}`, s.tree.diffSince(snap), [f.path]);
    s.history.push(`${plan.label} failed (${clip(first.state.summary ?? "", 90)}); fix:${n} ${f.fixSummary}`);
    await ctx.gate(`bash: ${plan.def.command}`);
    const retry = runCheck(task, s.impl, s.tree, plan);
    await ctx.step({ kind: "check", key: `${plan.key}:retry`, label: plan.label, ms: 1000, status: "verifying", output: retry.output });
    ctx.check(retry.state);
    s.checks.push(retry.state);
  }
}

async function integrate(ctx: Ctx, s: RunState, input: DevTaskInput, key: string): Promise<void> {
  ctx.phase("Integrate");
  const keys = [...s.unmerged];
  s.unmerged = [];
  await ctx.step({
    kind: "git",
    key,
    label: `integrate:${input.task.id}`,
    ms: 1000,
    status: "integrating",
    output: () => {
      for (const k of keys) ctx.merge(k);
      return { branch: input.task.branch, merged: keys, head: shortSha(`${input.task.branch}:${key}`) };
    },
  });
  if (keys.length) ctx.log(`Merged ${keys.join(", ")} into ${input.task.branch}`);
}

function agentSummary(input: DevTaskInput, s: RunState, stats: DiffTotals): string {
  const task = input.task;
  const files = diffStats(s.tree.diff());
  const out = [
    `# Agent summary: ${task.jiraKey ?? task.id} ${task.title}`,
    "",
    "## What changed",
    "",
    ...s.summaries.map((x) => `- ${x}`),
    "",
    ...(input.notes?.length ? ["## Developer notes received", "", ...input.notes.map((n) => `- ${n}`), ""] : []),
    `## Files (+${stats.adds} −${stats.dels} in ${stats.files})`,
    "",
    "| File | Status | + | − |",
    "| --- | --- | --- | --- |",
    ...files.map((f) => `| \`${cell(f.path)}\` | ${f.status} | ${f.adds} | ${f.dels} |`),
    "",
    "## Acceptance criteria",
    "",
    ...task.acceptanceCriteria.map((ac) => `- ${ac.id}: ${ac.text} -> ${s.impl.acCoverage[ac.id] ?? "not covered by an automated test; left for QA"}`),
    "",
    "## Notes",
    "",
    ...(s.impl.notes.length ? s.impl.notes.map((n) => `- ${n}`) : ["- none"]),
    "",
  ];
  if (task.blockedBy) out.push(`Blocked by: ${task.blockedBy}. Implemented against the current assumption; revisit when it is answered.`, "");
  return out.join("\n");
}

async function script(ctx: Ctx, input: DevTaskInput): Promise<DevTaskOutput> {
  const task = input.task;
  const key = task.jiraKey ?? task.id;
  const impl = taskImplFor(input.projectId, task);
  const s: RunState = {
    tree: new WorkingTree(impl.files.map((f) => ({ path: f.path, before: f.before }))),
    impl,
    checks: [],
    history: [],
    summaries: [],
    unmerged: [],
    fixes: 0,
  };
  const usd = roundUsd((SIZE_USD[task.size] ?? 0.9) + between(-8, 8, `${task.id}:${input.attempt}`) / 100);

  if (input.origin === "qa") {
    // The branch already holds the earlier attempt's (fixed) implementation.
    ctx.phase("Rework from QA");
    for (const f of impl.files) {
      if (f.after === undefined) s.tree.remove(f.path);
      else s.tree.write(f.path, f.after);
    }
    await ctx.gate(`git: checkout ${task.branch}`);
    await ctx.step({ kind: "git", key: "git:branch", label: `git.branch ${task.branch}`, ms: 1000, output: { branch: task.branch, created: false, attempt: input.attempt } });
    const feedback = input.feedback?.trim() || "QA reported bugs";
    const snap = s.tree.snapshot();
    const res = impl.qaRework?.(s.tree, feedback) ?? genericRework(s.tree, impl, task, input.attempt, feedback);
    s.summaries.push(impl.summary, `QA loop-back (attempt ${input.attempt}): ${res.summary}`);
    s.history.push(`Attempt ${input.attempt} started from QA: ${clip(feedback, 120)}`);
    await ctx.step({
      kind: "agent",
      key: `implement:${task.id}`,
      label: `implement:${task.id} · QA rework in ${basename(res.primaryFile ?? impl.primaryFile)}`,
      ms: 8000,
      usd,
      payload: { feedback, ...(input.notes?.length ? { notes: input.notes } : {}) },
      output: () => implOutput(res.summary, s.tree),
    });
    capture(ctx, s, `implement:${task.id}`, s.tree.diffSince(snap), s.tree.changedSince(snap));
    await verify(ctx, s, input, "", undefined);
  } else {
    ctx.phase("Prepare");
    await ctx.gate(`git: checkout -b ${task.branch} origin/master`);
    await ctx.step({ kind: "git", key: "git:branch", label: `git.branch ${task.branch}`, ms: 1000, output: { branch: task.branch, base: "master", created: true } });

    ctx.phase("Implement");
    const snap = s.tree.snapshot();
    for (const f of impl.files) {
      if (f.after === undefined) s.tree.remove(f.path);
      else s.tree.write(f.path, f.after);
    }
    const fault = input.attempt === 1 ? impl.fault : undefined;
    if (fault) s.tree.replace(fault.path, fault.correct, fault.broken);
    s.summaries.push(impl.summary);
    await ctx.step({
      kind: "agent",
      key: `implement:${task.id}`,
      label: `implement:${task.id} · editing ${basename(impl.primaryFile)}`,
      ms: 8000,
      usd,
      ...(input.notes?.length ? { payload: { notes: input.notes } } : {}),
      output: () => implOutput(impl.summary, s.tree),
    });
    capture(ctx, s, `implement:${task.id}`, s.tree.diffSince(snap), s.tree.changedSince(snap));
    await verify(ctx, s, input, "", fault);
  }
  await integrate(ctx, s, input, `integrate:${task.id}`);

  let reworkCycles = 0;
  let escalated = false;
  for (let cycle = 1; ; cycle++) {
    ctx.phase("Review");
    const latest = latestChecks(s.checks);
    const passed = latest.filter((c) => c.status === "pass").length;
    const stats = totals(diffStats(s.tree.diff()));
    const escalatedNow = reworkCycles >= input.maxReworkCycles;
    if (escalatedNow && !escalated) {
      escalated = true;
      ctx.note({ kind: "risk", text: `Rework limit reached (${reworkCycles}/${input.maxReworkCycles}) on ${key}; escalated to the developer`, evidence: `task:review:${cycle}` });
    }
    ctx.note({ kind: "claim", text: `${passed}/${latest.length} checks passed, +${stats.adds} −${stats.dels} in ${stats.files} files`, evidence: latest.map((c) => `check:${c.name}`).join(", ") });
    const question = `${escalatedNow ? "Escalated: " : ""}Review ${key}: ${task.title} (${passed}/${latest.length} checks passed, +${stats.adds} −${stats.dels} in ${stats.files} files). Approve it or request changes.`;
    const { answer } = await ctx.review<TaskReviewAnswer>({
      key: `task:review:${cycle}`,
      question,
      detail: latest.map((c) => `- ${c.name}: ${c.status}${c.summary ? ` (${c.summary})` : ""}`).join("\n"),
      schema: escalatedNow ? TASK_REVIEW_ESCALATED_SCHEMA : TASK_REVIEW_SCHEMA,
      risk: escalatedNow ? "medium" : "low",
      subject: { kind: "artifact", content: s.tree.diff(), mediaType: "text/x-diff", label: "changes" },
      attachments: [
        { label: "verification report", mediaType: "text/markdown", content: renderVerificationReport({ task, impl, checks: s.checks, history: s.history, cycle: reworkCycles }) },
        { label: "agent summary", mediaType: "text/markdown", content: agentSummary(input, s, stats) },
      ],
    });

    if (answer.decision === "approve" || answer.decision === "cancel") {
      return {
        taskId: task.id,
        approved: answer.decision === "approve",
        cancelled: answer.decision === "cancel",
        escalated,
        reworkCycles,
        diffStats: stats,
        checks: latest,
      };
    }

    // request-changes: rework on the same branch, then verify, integrate and review again.
    reworkCycles += 1;
    const n = reworkCycles;
    const feedback = answer.feedback?.trim() || "Address the review comments";
    ctx.phase(`Rework ${n}`);
    const snap = s.tree.snapshot();
    const res = impl.rework?.(s.tree, n, feedback) ?? genericRework(s.tree, impl, task, n, feedback);
    s.summaries.push(`Rework ${n}: ${res.summary}`);
    s.history.push(`Review ${cycle}: changes requested (${clip(feedback, 120)}); rework ${n}: ${clip(res.summary, 120)}`);
    await ctx.step({
      kind: "agent",
      key: `rework:${n}:${task.id}`,
      label: `rework:${n}:${task.id} · editing ${basename(res.primaryFile ?? impl.primaryFile)}`,
      ms: 6000,
      usd: roundUsd(usd * 0.65),
      payload: { feedback },
      output: () => implOutput(res.summary, s.tree),
    });
    capture(ctx, s, `rework:${n}:${task.id}`, s.tree.diffSince(snap), s.tree.changedSince(snap));
    await verify(ctx, s, input, `:rework:${n}`, undefined);
    await integrate(ctx, s, input, `integrate:rework:${n}`);
  }
}

export const devTask: MockWorkflow<DevTaskInput, DevTaskOutput> = {
  id: "dev-task",
  description: "Implement one planned task on its branch, verify it with checks, and have the developer approve it or request changes.",
  file: ".weft/workflows/dev-task/main.ts",
  input: jsonSchema(devTaskInputSchema),
  output: jsonSchema(devTaskOutputSchema, "output"),
  parseInput: parseDevTaskInput,
  defaults: { provider: "claude", model: "claude-opus-5", effort: "medium" },
  real: false,
  script,
};
