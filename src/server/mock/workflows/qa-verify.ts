import "server-only";
/**
 * qa-verify [SPEC]: independent QA of one implemented task with evidence. Phases: Test plan (agent
 * qa:plan, qa-planner table) -> Automated (bash qa:unit, qa:api, qa:e2e, each a check with command
 * evidence) -> Manual (agent browser session: recording with BEFORE/AFTER segments, stills, contact
 * sheet) -> Report (step "report" returns QaReportStepOutput and writes the evidence file) ->
 * Certify (qa:review:<attempt> on the evidence file). The verdict is the reviewer's.
 */
import {
  QA_REVIEW_SCHEMA,
  type QaReportStepOutput,
  type QaReviewAnswer,
  type QaVerifyInput,
  type QaVerifyOutput,
} from "@/lib/weft/workflows";
import { qaPackFor, type QaRun } from "@/server/mock/content/delivery/qa";
import type { MockWorkflow, ScriptCtx } from "../engine/api";
import { criteriaResults, evidencePath, qaQuestion, renderEvidenceFile, renderTestPlan } from "./delivery-lib/qa-format";
import { jsonSchema, parseQaVerifyInput, qaVerifyInputSchema, qaVerifyOutputSchema } from "./delivery-lib/schemas";
import { clip } from "./delivery-lib/util";

async function script(ctx: ScriptCtx<QaVerifyInput>, input: QaVerifyInput): Promise<QaVerifyOutput> {
  const task = input.task;
  const env = input.environment;
  const pack = qaPackFor(input.projectId, task, input.attempt, env);

  ctx.phase("Test plan");
  const testPlan = renderTestPlan(task, pack, input.attempt, env, input.readyForTest);
  await ctx.step({
    kind: "agent",
    key: "qa:plan",
    label: "qa:plan",
    ms: 3000,
    usd: 0.35,
    // The planner reads the developer's Ready-for-test handoff (what to check, what dev covered).
    ...(input.readyForTest ? { payload: { readyForTest: input.readyForTest } } : {}),
    output: { scenarios: pack.plan.length, criteria: task.acceptanceCriteria.map((a) => a.id), risks: pack.risks, markdown: testPlan },
  });

  ctx.phase("Automated");
  const runs: Array<[string, QaRun, number]> = [
    ["unit", pack.unit, 1000],
    ["api", pack.api, 1000],
    ["e2e", pack.e2e, 2500],
  ];
  for (const [name, run, ms] of runs) {
    const ok = run.exitCode === 0 && run.counts.failed === 0;
    await ctx.gate(`bash: ${run.command}`);
    await ctx.step({
      kind: "bash",
      key: `qa:${name}`,
      label: `qa:${name}`,
      ms,
      status: "verifying",
      output: { command: run.command, exitCode: run.exitCode, counts: run.counts, summary: run.summary, output: run.output },
    });
    ctx.check({
      name: `qa:${name}`,
      status: ok ? "pass" : "fail",
      disposition: "executed",
      summary: run.summary,
      evidence: run.command,
      details: [{ kind: "command", exitCode: run.exitCode, output: run.output }],
      required: true,
    });
  }

  ctx.phase("Manual");
  const manual = pack.evidence.filter((e) => e.mode === "manual");
  const video = manual.find((e) => e.kind === "video");
  await ctx.step({
    kind: "agent",
    key: "qa:manual",
    label: "qa:manual · browser session",
    ms: 6000,
    usd: 0.85,
    output: {
      environment: env,
      account: pack.account,
      underTest: pack.underTest,
      baseline: pack.baseline,
      segments: video?.segments ?? [],
      timeline: video?.timeline ?? [],
      artifacts: manual.map((e) => ({ kind: e.kind, title: e.title, url: e.url, result: e.result })),
    },
  });

  ctx.phase("Report");
  const criteria = criteriaResults(task, pack.evidence);
  const path = evidencePath(task);
  const evidenceFile = renderEvidenceFile(task, pack, criteria, input.attempt, env);
  const report: QaReportStepOutput = { evidence: pack.evidence, criteria, evidencePath: path };
  await ctx.step({
    kind: "agent",
    key: "report",
    label: `report · ${path}`,
    ms: 2000,
    usd: 0.25,
    output: () => {
      ctx.fs.write(path, evidenceFile);
      return report;
    },
  });
  const failing = criteria.filter((c) => c.result === "fail");
  if (failing.length) ctx.note({ kind: "risk", text: `${failing.map((c) => c.id).join(", ")} failed: ${clip(pack.bugs[0] ?? failing[0].text, 140)}`, evidence: path });

  ctx.phase("Certify");
  const { answer } = await ctx.review<QaReviewAnswer>({
    key: `qa:review:${input.attempt}`,
    question: qaQuestion(task, criteria, pack.evidence),
    detail: criteria.map((c) => `- ${c.id} ${c.result}: ${c.text}`).join("\n"),
    schema: QA_REVIEW_SCHEMA,
    risk: failing.length ? "medium" : "low",
    subject: { kind: "file", path, mode: "view" },
    attachments: [{ label: "test plan", mediaType: "text/markdown", content: testPlan }],
  });

  const bugs = answer.bugs?.filter((b) => b.trim()).map((b) => b.trim()) ?? [];
  const fallbackBugs = pack.bugs.length ? pack.bugs : failing.map((c) => `${c.id} not met: ${c.text}`);
  return {
    taskId: task.id,
    verdict: answer.verdict,
    bugs: bugs.length ? bugs : answer.verdict === "bugs-found" ? fallbackBugs : [],
    comment: answer.comment ?? "",
  };
}

export const qaVerify: MockWorkflow<QaVerifyInput, QaVerifyOutput> = {
  id: "qa-verify",
  description: "Test one implemented task with automated and manual checks and evidence, then have QA certify it, report bugs, or mark it blocked.",
  file: ".weft/workflows/qa-verify/main.ts",
  input: jsonSchema(qaVerifyInputSchema),
  output: jsonSchema(qaVerifyOutputSchema, "output"),
  parseInput: parseQaVerifyInput,
  defaults: { provider: "claude", model: "claude-opus-5", effort: "medium" },
  real: false,
  script,
};
