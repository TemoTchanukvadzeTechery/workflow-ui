import "server-only";
/**
 * qa-verify documents: the qa-planner style test plan (# | Scenario | Steps | Expected Result, then
 * Risks) and the evidence file in the /deliver format (.deliver/evidence/<repo>/<KEY>.md with
 * # Evidence, ## Build, ## Verify, plus the web-recording "Claim + timeline" block).
 */
import type { EvidenceDraft, QaReportStepOutput } from "@/lib/weft/workflows";
import type { QaPack } from "@/server/mock/content/delivery/qa";
import type { RunTask } from "@/server/mock/content/delivery/types";
import { bullets, cell, stripScope } from "./util";

export type CriterionResult = QaReportStepOutput["criteria"][number];

export function evidencePath(task: RunTask): string {
  return `.deliver/evidence/${task.repo}/${task.jiraKey ?? task.id}.md`;
}

/** Per AC: any fail -> fail; else any pass -> pass; else inconclusive (including no evidence). */
export function criteriaResults(task: RunTask, evidence: readonly EvidenceDraft[]): CriterionResult[] {
  return task.acceptanceCriteria.map((ac) => {
    const results = evidence.flatMap((e) => e.criterionResults.filter((r) => r.criterionId === ac.id).map((r) => r.result));
    const result = results.includes("fail") ? "fail" : results.includes("pass") ? "pass" : "inconclusive";
    return { id: ac.id, text: ac.text, result };
  });
}

/** The exact qa:review question from workflows.ts. */
export function qaQuestion(task: RunTask, criteria: readonly CriterionResult[], evidence: readonly EvidenceDraft[]): string {
  const met = criteria.filter((c) => c.result === "pass").length;
  const auto = evidence.filter((e) => e.mode === "automated").length;
  const manual = evidence.length - auto;
  return `QA ${task.jiraKey ?? task.id}: ${met}/${criteria.length} acceptance criteria met, ${evidence.length} evidence items (${auto} automated, ${manual} manual). Certify it, report bugs, or mark it blocked.`;
}

export function renderTestPlan(task: RunTask, pack: QaPack, attempt: number, environment: string, readyForTest?: string): string {
  const key = task.jiraKey ?? task.id;
  // The developer's "What to check" line for this task, from the Ready-for-test handoff note.
  const handoff = readyForTest?.split("\n").find((l) => l.startsWith("- ") && l.includes(key) && /AC-\d/.test(l));
  const out = [
    `# Test plan: ${key} ${stripScope(task.title)}`,
    "",
    `Environment: ${environment} · Under test: \`${pack.underTest.build}\` · Baseline: \`${pack.baseline.build}\` · Accounts: ${pack.account} · Attempt ${attempt}`,
    "",
    ...(readyForTest ? [`Developer handoff (Ready for test): ${handoff ? cell(handoff.slice(2)) : "read; no line names this task"}`, ""] : []),
    "| # | Scenario | Steps | Expected Result |",
    "| --- | --- | --- | --- |",
  ];
  pack.plan.forEach((s, i) => {
    out.push(`| ${i + 1} | ${cell(s.scenario)} | ${s.steps.map((st, j) => `${j + 1}. ${cell(st)}`).join("<br>")} | ${cell(s.expected)} |`);
  });
  out.push("", "## Risks", "", bullets(pack.risks), "");
  return out.join("\n");
}

function resultLabel(r: "pass" | "fail" | "inconclusive"): string {
  return r === "pass" ? "Pass" : r === "fail" ? "Fail" : "Inconclusive";
}

function fileName(e: EvidenceDraft): string {
  return e.url ? (e.url.split("/").pop() ?? e.title) : e.title;
}

export function renderEvidenceFile(task: RunTask, pack: QaPack, criteria: readonly CriterionResult[], attempt: number, environment: string): string {
  const key = task.jiraKey ?? task.id;
  const failed = criteria.filter((c) => c.result === "fail");
  const open = criteria.filter((c) => c.result === "inconclusive");
  const verdict = failed.length
    ? `FAIL (${failed.map((c) => c.id).join(", ")})`
    : open.length
      ? `PASS with ${open.length} inconclusive (${open.map((c) => c.id).join(", ")})`
      : "PASS";
  const out: string[] = [
    `# Evidence: ${key} ${stripScope(task.title)}`,
    "",
    "| | |",
    "| --- | --- |",
    `| Task | ${task.id}${task.jiraKey ? ` · ${task.jiraKey}` : ""} |`,
    `| Repo | ${task.repo} |`,
    `| Branch | \`${task.branch}\` |`,
    `| Environment | ${environment} |`,
    `| Attempt | ${attempt} |`,
    `| Recorded by | qa-verify agent (claude-opus-5) |`,
    `| Result | ${verdict} |`,
    "",
    "## Build",
    "",
    `- Baseline: \`${pack.baseline.host}\` build \`${pack.baseline.build}\``,
    `- Under test: \`${pack.underTest.host}\` build \`${pack.underTest.build}\``,
  ];
  for (const run of [pack.unit, pack.api, pack.e2e]) {
    out.push(`- \`${run.command}\`: exit ${run.exitCode}, ${run.summary}`);
  }
  out.push("", "## Verify", "", "| AC | Criterion | Result | Evidence |", "| --- | --- | --- | --- |");
  for (const c of criteria) {
    const items = pack.evidence.filter((e) => e.criterionResults.some((r) => r.criterionId === c.id)).map(fileName);
    out.push(`| ${c.id} | ${cell(c.text)} | ${resultLabel(c.result)} | ${cell(items.slice(0, 3).join(", ") || "none")} |`);
  }

  const video = pack.evidence.find((e) => e.kind === "video");
  if (video) {
    const segs = (video.segments ?? []).map((s) => `${s.label} ${s.host} ${s.build}`).join(" · ");
    const dur = video.durationSec ? `${String(Math.floor(video.durationSec / 60)).padStart(2, "0")}:${String(video.durationSec % 60).padStart(2, "0")}` : "";
    out.push("", "### Claim + timeline", "", `**Claim:** ${pack.claim}`, "", `Video: \`${fileName(video)}\` (H.264${dur ? `, ${dur}` : ""})${segs ? ` · ${segs}` : ""}`, "");
    out.push("| Time | Event |", "| --- | --- |");
    for (const t of video.timeline ?? []) out.push(`| ${t.t} | ${cell(t.text)} |`);
    out.push("", pack.backend);
  }

  out.push("", "### Items", "");
  pack.evidence.forEach((e, i) => {
    const acs = e.criterionResults.map((r) => r.criterionId).join(", ");
    out.push(`${i + 1}. [${resultLabel(e.result)}] ${e.title} (${e.kind}, ${e.mode}${e.testLevel ? `, ${e.testLevel}` : ""})${acs ? ` - ${acs}` : ""}${e.url ? ` - \`${fileName(e)}\`` : ""}`);
  });

  for (const e of pack.evidence.filter((x) => x.excerpt)) {
    out.push("", `<details><summary>${e.command ? `${e.command} (exit ${e.exitCode ?? 0})` : e.title}</summary>`, "", "```", e.excerpt ?? "", "```", "", "</details>");
  }
  const data = pack.evidence.find((e) => e.kind === "data" || e.kind === "metric");
  if (data?.data !== undefined) {
    out.push("", `<details><summary>${data.title}</summary>`, "", "```json", JSON.stringify(data.data, null, 2), "```", "", "</details>");
  }

  out.push("", "## Regression", "", bullets(pack.regression));
  if (failed.length || open.length) {
    out.push("", "## Needs attention", "");
    for (const c of [...failed, ...open]) {
      const detail = pack.evidence.flatMap((e) => e.criterionResults.filter((r) => r.criterionId === c.id && r.result !== "pass" && r.detail).map((r) => r.detail));
      out.push(`- ${c.id} ${resultLabel(c.result).toLowerCase()}: ${c.text}${detail[0] ? ` (${detail[0]})` : ""}`);
    }
  }
  out.push("");
  return out.join("\n");
}
