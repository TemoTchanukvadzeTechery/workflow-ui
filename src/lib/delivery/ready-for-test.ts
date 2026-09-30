/**
 * The "Ready for test" handoff note (brief C.3 gate; process doc dev-test-handoff), prefilled
 * from the approved tasks. Isomorphic and pure (no clock, no randomness): the Implementation gate
 * dialog shows this draft for editing, and the server writes the very same text when the
 * decision carries no edited note, so the stored document is what the dialog showed.
 */
import { plural } from "@/lib/format";
import type { DeliveryTask, ProjectBundle } from "./types";

/** Sections in the order QA expects them. */
export const READY_FOR_TEST_SECTIONS = ["TL;DR", "Env", "Branch", "What to check", "Regression (dev-covered)", "Markets", "Localization", "Notes", "Evidence"] as const;

const QA_ENVIRONMENT = "internal-apps-test";

function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

const label = (t: Pick<DeliveryTask, "id" | "jiraKey">) => t.jiraKey ?? t.id;

/** Latest result per check name (a retried check keeps its last outcome). */
function latestChecks(checks: DeliveryTask["checks"]): DeliveryTask["checks"] {
  const by = new Map<string, DeliveryTask["checks"][number]>();
  for (const c of checks) by.set(c.name, c);
  return [...by.values()];
}

export function readyForTestDraft(bundle: Pick<ProjectBundle, "project" | "tasks">): string {
  const tasks = bundle.tasks.filter((t) => t.status === "done");
  const cancelled = bundle.tasks.filter((t) => t.status === "cancelled");
  const repos = uniq(tasks.map((t) => t.repo));
  const escalated = tasks.filter((t) => t.escalated);

  const regression = repos.map((repo) => {
    const ts = tasks.filter((t) => t.repo === repo);
    const checks = ts.flatMap((t) => latestChecks(t.checks));
    const passed = checks.filter((c) => c.status === "pass").length;
    const names = uniq(checks.map((c) => c.name)).join(", ");
    return checks.length
      ? `- Covered: ${repo} · ${names} ${passed}/${checks.length} passed · unchanged · .deliver/evidence/${repo}/${ts.map(label).join("-")}.md`
      : `- Not covered: ${repo} · no automated checks recorded -> QA`;
  });

  const notes = [
    ...escalated.map((t) => `- ${label(t)} was approved after the rework limit (escalated); check it first.`),
    ...cancelled.map((t) => `- ${label(t)} ${t.title} was cancelled and is not part of this handoff.`),
  ];

  const lines = [
    `# Ready for test: ${bundle.project.name}`,
    "",
    "## TL;DR",
    `${plural(tasks.length, "task")} implemented by agents and approved by the developer across ${plural(repos.length, "repo")}: ${tasks.map(label).join(", ") || "none"}.`,
    "",
    "## Env",
    `${QA_ENVIRONMENT} (branch previews per task)`,
    "",
    "## Branch",
    ...tasks.map((t) => `- ${label(t)} \`${t.branch}\` (${t.repo})`),
    "",
    "## What to check",
    ...tasks.map((t) => `- ${label(t)} ${t.title}: ${t.acceptanceCriteria.map((ac) => `${ac.id} ${ac.text}`).join("; ") || "see the task"}`),
    "",
    "## Regression (dev-covered)",
    ...(regression.length ? regression : ["- Not covered: no repos changed -> QA"]),
    "",
    "## Markets",
    "US (per the BRD scope)",
    "",
    "## Localization",
    "en-US covered by dev checks; es-US not covered -> QA",
    "",
    "## Notes",
    ...(notes.length ? notes : ["None."]),
    "",
    "## Evidence",
    ...tasks.map((t) => {
      const checks = latestChecks(t.checks);
      const passed = checks.filter((c) => c.status === "pass").length;
      return `- ${label(t)}: dev-task run ${t.runIds.at(-1) ?? "n/a"} · ${passed}/${checks.length} checks passed${t.diffStats ? ` · +${t.diffStats.adds} −${t.diffStats.dels} in ${t.diffStats.files} files` : ""}`;
    }),
    "",
  ];
  return lines.join("\n");
}

/** Section headings the note is missing (shown as a warning, not a blocker). */
export function missingSections(markdown: string): string[] {
  const have = new Set(
    markdown
      .split("\n")
      .map((l) => /^##\s+(.+?)\s*$/.exec(l)?.[1]?.toLowerCase())
      .filter((x): x is string => !!x),
  );
  return READY_FOR_TEST_SECTIONS.filter((s) => !have.has(s.toLowerCase()));
}
