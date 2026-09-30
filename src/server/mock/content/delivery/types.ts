import "server-only";
/**
 * Content-pack shapes for the Stage 3-4 mock workflows. Packs are keyed by project id (the seeded
 * demo projects) with a generic fallback, and are pure data plus small functions over a
 * WorkingTree, so every run of the same task produces the same diff.
 */
import type { DevTaskInput, PlannedTask, PlanReport, PlanReportExtras } from "@/lib/weft/workflows";
import type { FileSpec, WorkingTree } from "@/server/mock/workflows/delivery-lib/diff";
import type { DocContext } from "@/server/mock/workflows/delivery-lib/docs";
import type { EpicHint, PlanEpic } from "@/server/mock/workflows/delivery-lib/plan";

export type RunTask = DevTaskInput["task"];

// ---------------------------------------------------------------------------------------------
// dev-plan
// ---------------------------------------------------------------------------------------------

export interface PlanTaskSeed extends Omit<PlannedTask, "epicId" | "team"> {
  epic: EpicHint;
  team?: string;
}

export interface PlanPack {
  /** One paragraph for the plan's Summary section. */
  summary: string;
  tasks: PlanTaskSeed[];
  report: PlanReport & PlanReportExtras;
  /** A hand-written plan that already reflects the seeded developer notes. */
  curated?: boolean;
}

export interface PlanContext {
  projectId: string;
  docs: DocContext;
  epics: readonly PlanEpic[];
  notes: readonly string[];
}

// ---------------------------------------------------------------------------------------------
// dev-task
// ---------------------------------------------------------------------------------------------

export type CheckName = "typecheck" | "lint" | "unit" | "contract" | "e2e";

/**
 * A first-attempt defect: the implement step writes `broken` instead of `correct`, the named check
 * fails on it, and a fix step swaps it back. A one-line swap keeps the task's diff stats unchanged.
 */
export interface Fault {
  check: CheckName;
  path: string;
  broken: string;
  correct: string;
  /** Tool output of the failing run. */
  output: string;
  /** Short failure text for the check summary and file evidence. */
  message: string;
  /** What the fix step reports. */
  fixSummary: string;
}

export interface CheckOverride {
  command?: string;
  /** Output of a passing run (replaces the generated one). */
  output?: string;
  summary?: string;
  metric?: { name: string; actual: number; expected?: number; unit?: string };
}

export interface ReworkResult {
  /** One line for the agent summary and the ledger, e.g. "Forward the bearer token unchanged". */
  summary: string;
  /** Files the rework touched, for the step label. */
  primaryFile?: string;
}

export interface TaskImpl {
  /** What the agent reports after implementing (agent summary attachment). */
  summary: string;
  /** Decisions and risks the agent noted. */
  notes: string[];
  /** Final (correct) state of every touched file. */
  files: FileSpec[];
  /** Shown in the implement step label: "implement:T-6 · editing <file name>". */
  primaryFile: string;
  /** AC id -> the test or code that covers it. */
  acCoverage: Record<string, string>;
  fault?: Fault;
  /** Tests already in the suite before this change (unit total = base + tests in the diff). */
  baseTests: number;
  /** Test suites in the unit run (TypeScript repos print it). */
  suites?: number;
  checks?: Partial<Record<CheckName, CheckOverride>>;
  /** Bespoke developer-rework handler; return undefined to fall back to the generic one. */
  rework?: (tree: WorkingTree, cycle: number, feedback: string) => ReworkResult | undefined;
  /** Bespoke handler for a QA loop-back run (origin "qa"). */
  qaRework?: (tree: WorkingTree, feedback: string) => ReworkResult | undefined;
}

// ---------------------------------------------------------------------------------------------
// qa-verify
// ---------------------------------------------------------------------------------------------

export interface QaScenario {
  scenario: string;
  steps: string[];
  expected: string;
}
