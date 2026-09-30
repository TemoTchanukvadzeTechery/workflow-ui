import "server-only";
/**
 * dev-task Verify phase content: the CheckState for each check (command evidence, a metric where
 * it fits, file evidence for a failure), tool output that matches the repo's toolchain, and the
 * "verification report" attachment.
 */
import type { CheckEvidence, CheckState } from "@/lib/weft/types";
import type { CheckName, Fault, RunTask, TaskImpl } from "@/server/mock/content/delivery/types";
import { checkDefs, countTests, repoKind, type CheckDef } from "@/server/mock/content/delivery/templates/repos";
import type { WorkingTree } from "./diff";
import { between, cell, clip } from "./util";

export interface CheckPlan {
  def: CheckDef;
  /** Step key; unique per run ("check:unit", "check:unit:retry", "check:unit:rework:1"). */
  key: string;
  /** Step label; the orchestrator shows it as the task's latest step. */
  label: string;
}

export function checkPlans(task: RunTask, impl: TaskImpl, suffix = ""): CheckPlan[] {
  const focus = repoKind(task.repo) === "e2e" ? `com.plexus.pww.agreements.${/(\w+)\.kt$/.exec(impl.primaryFile)?.[1] ?? "*"}` : task.id;
  return checkDefs(task.repo, focus).map((def) => {
    const command = impl.checks?.[def.name]?.command ?? def.command;
    return { def: { ...def, command }, key: `check:${def.name}${suffix}`, label: `check:${def.name}` };
  });
}

function lineOf(text: string | undefined, needle: string): number {
  if (!text) return 1;
  const idx = text.split("\n").findIndex((l) => l.includes(needle.trim()));
  return idx < 0 ? 1 : idx + 1;
}

function testTotals(impl: TaskImpl, tree: WorkingTree): { total: number; suites: number } {
  const total = impl.baseTests + countTests(tree.entries());
  return { total, suites: impl.suites ?? Math.max(3, Math.round(total / 5)) };
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

function testLines(impl: TaskImpl, style: "gradle" | "jest" | "vitest"): string {
  const entries = Object.entries(impl.acCoverage).slice(0, 5);
  if (style === "gradle") return entries.map(([ac, t]) => `${clip(t.split(" + ")[0], 80)} (${ac}) PASSED`).join("\n");
  return entries.map(([ac, t]) => `    ✓ ${ac}: ${clip(t.split(" › ").pop() ?? t, 70)}`).join("\n");
}

function passingOutput(task: RunTask, impl: TaskImpl, tree: WorkingTree, name: CheckName): { output: string; summary: string } {
  const kind = repoKind(task.repo);
  const { total, suites } = testTotals(impl, tree);
  const s = (k: string) => between(6, 48, `${task.id}:${k}`);
  switch (`${kind}:${name}`) {
    case "java:typecheck":
      return { output: `> Task :compileJava\n> Task :compileTestJava\n\nBUILD SUCCESSFUL in ${s("tc")}s\n6 actionable tasks: 2 executed, 4 up-to-date`, summary: "compiled, 0 errors" };
    case "java:lint":
      return { output: `> Task :spotlessJavaCheck\n> Task :checkstyleMain\n\nBUILD SUCCESSFUL in ${s("lint")}s`, summary: "spotless and checkstyle clean" };
    case "java:unit":
      return { output: `> Task :test\n\n${testLines(impl, "gradle")}\n\nTests: ${total} passed, ${total} total\nBUILD SUCCESSFUL in ${s("unit")}s`, summary: `${total} passed, ${total} total` };
    case "java:contract":
      return { output: `> Task :contractTest\n\nContractVerifierTest > validate_200() PASSED\nContractVerifierTest > validate_401_withoutToken() PASSED\n\nBUILD SUCCESSFUL in ${s("ct")}s`, summary: "2 contract cases passed" };
    case "angular:typecheck":
      return { output: `> nx run ${task.repo}:typecheck\n\n NX   Successfully ran target typecheck for project ${task.repo}`, summary: "tsc: 0 errors" };
    case "angular:lint":
      return { output: `Linting "${task.repo}"...\n\nAll files pass linting.`, summary: "0 problems" };
    case "angular:unit":
      return { output: `${testLines(impl, "jest")}\n\nTest Suites: ${suites} passed, ${suites} total\nTests:       ${total} passed, ${total} total\nSnapshots:   0 total\nTime:        ${(s("jest") / 3).toFixed(3)} s`, summary: `${total} passed, ${total} total` };
    case "angular:e2e":
      return { output: `Running 4 tests using 2 workers\n\n  ✓ [chromium] renders for a Legal user (3.1s)\n  ✓ [chromium] error state shows no figures (2.2s)\n  ✓ [chromium] hidden when the flag is off (1.9s)\n  ✓ [chromium] as-of timestamp shown (1.4s)\n\n  4 passed (14.2s)`, summary: "4 passed" };
    case "gateway:typecheck":
      return { output: "routes/agreements.yaml: valid (gateway schema v3, 4 routes)", summary: "routes valid" };
    case "gateway:lint":
      return { output: "yamllint -s routes/\n0 errors, 0 warnings", summary: "0 problems" };
    case "gateway:unit":
      return { output: `${testLines(impl, "vitest")}\n\n Test Files  ${suites} passed (${suites})\n      Tests  ${total} passed (${total})`, summary: `${total} passed` };
    case "gateway:contract":
      return { output: "contract:verify routes against api-contracts@2.4.0\n  agreements: 4/4 interactions verified\nadded latency p95 6 ms (budget 20 ms)", summary: "4/4 interactions verified" };
    case "contracts:typecheck":
      return { output: "bundle: dist/agreements.yaml written (4 paths, 11 schemas)", summary: "bundled" };
    case "contracts:lint":
      return { output: "validating index.yaml...\nWoohoo! Your API description is valid.", summary: "valid, 0 warnings" };
    case "contracts:unit":
      return { output: `examples: ${total} validated against their schemas\n${total} passed, 0 failed`, summary: `${total} examples valid` };
    case "contracts:contract":
      return { output: "oasdiff breaking origin/master HEAD\nNo breaking changes", summary: "no breaking changes" };
    case "auth0:typecheck":
      return { output: "Success! The configuration is valid.", summary: "terraform validate: valid" };
    case "auth0:lint":
      return { output: "eslint actions/: 0 problems\nterraform fmt -check -recursive: no changes", summary: "eslint and terraform fmt clean" };
    case "auth0:unit":
      return { output: `${testLines(impl, "jest")}\n\nTest Suites: ${suites} passed, ${suites} total\nTests:       ${total} passed, ${total} total\nTime:        ${(s("jest") / 4).toFixed(3)} s`, summary: `${total} passed, ${total} total` };
    case "auth0:contract":
      return { output: "  # auth0_action updated in-place\n\nPlan: 0 to add, 1 to change, 0 to destroy.", summary: "plan: 1 to change" };
    case "e2e:typecheck":
      return { output: `> Task :compileTestKotlin\n\nBUILD SUCCESSFUL in ${s("kt")}s`, summary: "compiled" };
    case "e2e:lint":
      return { output: `> Task :ktlintTestSourceSetCheck\n\nBUILD SUCCESSFUL in ${s("ktl")}s`, summary: "ktlint clean" };
    case "e2e:unit":
      return { output: `> Task :test\n\nframework self-tests\nTests: ${total} passed, ${total} total\nBUILD SUCCESSFUL in ${s("fw")}s`, summary: `${total} passed` };
    case "e2e:e2e":
      return {
        output: `${testLines(impl, "gradle")}\n\n${Object.keys(impl.acCoverage).length} tests completed, 0 failed\nBUILD SUCCESSFUL in ${s("e2e") + 20}s`,
        summary: `${Object.keys(impl.acCoverage).length} passed on internal-apps-test`,
      };
    default:
      return { output: "ok", summary: "passed" };
  }
}

function defaultMetric(task: RunTask, name: CheckName): CheckEvidence | undefined {
  const kind = repoKind(task.repo);
  if (kind === "java" && name === "contract") return { kind: "metric", name: "p95 latency", actual: between(110, 260, task.id), expected: 500, unit: "ms" };
  if (kind === "angular" && name === "e2e") return { kind: "metric", name: "LCP", actual: between(9, 19, task.id) / 10, expected: 2.5, unit: "s" };
  if (kind === "gateway" && name === "contract") return { kind: "metric", name: "added latency p95", actual: 6, expected: 20, unit: "ms" };
  return undefined;
}

export interface CheckResult {
  state: CheckState;
  /** Step output for the check step (weft check steps carry their own result object). */
  output: { name: string; result: "pass" | "fail"; command: string; exitCode: number; summary?: string };
}

export function runCheck(task: RunTask, impl: TaskImpl, tree: WorkingTree, plan: CheckPlan, fault?: Fault): CheckResult {
  const name = plan.def.name;
  if (fault && fault.check === name) {
    const line = lineOf(tree.get(fault.path), fault.broken);
    const { total, suites } = testTotals(impl, tree);
    const vars = { line, total, passed: Math.max(0, total - 1), suites: Math.max(0, suites - 1), suitesTotal: suites };
    const output = fill(fault.output, vars);
    const message = fill(fault.message, vars);
    return {
      state: {
        name,
        status: "fail",
        disposition: "executed",
        summary: message,
        evidence: plan.def.command,
        details: [
          { kind: "command", exitCode: 1, output },
          { kind: "file", path: fault.path, line, message },
        ],
        required: true,
      },
      output: { name, result: "fail", command: plan.def.command, exitCode: 1, summary: message },
    };
  }
  const override = impl.checks?.[name];
  const generated = passingOutput(task, impl, tree, name);
  const output = override?.output ?? generated.output;
  const summary = override?.summary ?? generated.summary;
  const metric = override?.metric ? ({ kind: "metric", ...override.metric } as CheckEvidence) : defaultMetric(task, name);
  const details: CheckEvidence[] = [{ kind: "command", exitCode: 0, output }];
  if (metric) details.push(metric);
  return {
    state: { name, status: "pass", disposition: "executed", summary, evidence: plan.def.command, details, required: true },
    output: { name, result: "pass", command: plan.def.command, exitCode: 0, summary },
  };
}

/** Latest result per check name, in first-seen order. */
export function latestChecks(checks: readonly CheckState[]): CheckState[] {
  const byName = new Map<string, CheckState>();
  for (const c of checks) byName.set(c.name, c);
  return [...byName.values()];
}

export interface VerificationArgs {
  task: RunTask;
  impl: TaskImpl;
  checks: readonly CheckState[];
  history: readonly string[];
  cycle: number;
}

export function renderVerificationReport(a: VerificationArgs): string {
  const latest = latestChecks(a.checks);
  const passed = latest.filter((c) => c.status === "pass").length;
  const out: string[] = [
    `# Verification: ${a.task.jiraKey ?? a.task.id}`,
    "",
    `${passed}/${latest.length} checks passed${a.cycle > 0 ? ` after rework ${a.cycle}` : ""}. Branch \`${a.task.branch}\`, repo \`${a.task.repo}\`.`,
    "",
    "| Check | Result | Command | Exit | Summary |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const c of latest) {
    const cmd = c.details?.find((d) => d.kind === "command");
    out.push(
      `| ${c.name} | ${c.status === "pass" ? "Pass" : "Fail"} | \`${cell(c.evidence ?? "")}\` | ${cmd && cmd.kind === "command" ? cmd.exitCode : ""} | ${cell(c.summary ?? "")} |`,
    );
  }
  const metrics = latest.flatMap((c) => (c.details ?? []).filter((d) => d.kind === "metric").map((d) => ({ c, d })));
  if (metrics.length) {
    out.push("", "## Metrics", "");
    for (const { c, d } of metrics) {
      if (d.kind !== "metric") continue;
      const within = d.expected === undefined || d.actual <= d.expected;
      out.push(`- ${c.name}: ${d.name} ${d.actual}${d.unit ?? ""}${d.expected !== undefined ? ` (budget ${d.expected}${d.unit ?? ""}, ${within ? "within" : "over"})` : ""}`);
    }
  }
  out.push("", "## Acceptance criteria", "");
  for (const ac of a.task.acceptanceCriteria) out.push(`- ${ac.id}: ${ac.text} -> ${a.impl.acCoverage[ac.id] ?? "no automated check; QA to verify"}`);
  if (a.history.length) {
    out.push("", "## Run history", "");
    for (const h of a.history) out.push(`- ${h}`);
  }
  out.push("");
  return out.join("\n");
}
