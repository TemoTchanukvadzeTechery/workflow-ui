/**
 * Inputs, outputs, human-request keys and answer schemas of the five workflows the UI drives.
 * po-brd and architect-aad are REAL (copied from po-workspace/.weft/workflows); dev-plan, dev-task
 * and qa-verify are SPEC, shaped like po-brd so a real weft workflow can adopt them unchanged.
 * Isomorphic: imported by the mock scripts (server) and the bespoke review forms (client).
 */
import type { AadReport, DraftReport, EvidenceKind, MemoryStatus } from "@/lib/delivery/types";
import type { CheckState, FileStat, JsonSchema } from "@/lib/weft/types";

// ---------------------------------------------------------------------------------------------
// po-brd [REAL]  phases: Preflight → Memory → Discover → Draft 1..N → Update memory
// ---------------------------------------------------------------------------------------------

export interface PoBrdInput {
  request: string;
  /** Repo-relative note files; an entry that is not a file is used as note text. */
  notes: string[];
  out: string;
  skill: string;
  maxRounds: number;
  discover: boolean;
  /** Jira keys or Confluence page ids already known to matter. */
  seeds: string[];
  discoveryRounds: number;
  maxQueries: number;
}

export interface DocWorkflowOutput<R> {
  path: string;
  accepted: boolean;
  rounds: number;
  lastReport: R;
  dependencies: Array<{ id: string; ref: string; kind: string; relation: string; title: string }>;
  memory: { status: MemoryStatus; major: boolean; changes: string[]; stale: string[] };
  skillSha256: string;
}
export type PoBrdOutput = DocWorkflowOutput<DraftReport>;

// ---------------------------------------------------------------------------------------------
// architect-aad [REAL]  same phases; input.brd is the accepted BRD path
// ---------------------------------------------------------------------------------------------

export interface ArchitectAadInput extends PoBrdInput {
  brd: string;
}
export type ArchitectAadOutput = DocWorkflowOutput<AadReport>;

// ---------------------------------------------------------------------------------------------
// Human requests shared by po-brd and architect-aad [REAL]
// ---------------------------------------------------------------------------------------------

/**
 * key "deps:review:<pass>" (pass 1..3), kind "ask", phase "Discover".
 * question: `Pass ${pass}: ${n} dependencies found for this ${doc}. Continue drafting with them, or search more?`
 * detail: one entry per dependency: `- <ref> [<kind>, <relation>] <title>[ (content not fetched)]\n  <why>` or `- none found`.
 */
export interface DependencyReviewAnswer {
  decision: "continue" | "search-more";
  add?: string[];
  remove?: string[];
  guidance?: string;
}
export const DEPENDENCY_REVIEW_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["continue", "search-more"], description: "continue drafts with these sources; search-more runs more discovery" },
    add: { default: [], description: "Jira keys or Confluence page ids to add", type: "array", items: { type: "string" } },
    remove: { default: [], description: "Refs to drop", type: "array", items: { type: "string" } },
    guidance: { default: "", description: "What to look for in the next discovery round", type: "string" },
  },
  required: ["decision"],
};

/**
 * key "review:<round>", kind "review", phase "Draft <round>".
 * reviewSubject { kind: "file", path: out, mode: "edit" }; attachment "draft report" (text/markdown).
 */
export interface DocReviewAnswer {
  decision: "accept" | "revise";
  feedback?: string;
  newNotes?: string[];
}
export const DOC_REVIEW_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["accept", "revise"], description: "accept ends drafting; revise runs another drafting round" },
    feedback: { default: "", description: "What to change in the next round", type: "string" },
    newNotes: { default: [], description: "Extra note files (repository-relative paths) or note text to add", type: "array", items: { type: "string" } },
  },
  required: ["decision"],
};

/**
 * key "memory:review" (or "memory:review:rebase"), kind "review", phase "Update memory".
 * question: `${major ? "Major" : "Minor"} update to the shared memory from this ${doc} (${n} changes; see the diff). Apply it so future BRD and AAD runs see it?`
 * reviewSubject { kind: "artifact", mediaType: "text/markdown", label: "memory/memory.md" } (the proposed file);
 * attachments: "diff" (text/plain, "+ "/"- " lines) and "changes" (text/markdown: "## Changes" list of "- <kind>: <summary>", then "## Affects other documents").
 */
export interface MemoryReviewAnswer {
  decision: "apply" | "discard";
  /** Optional full memory text to write instead of the proposal. */
  replacement?: string;
}
export const MEMORY_REVIEW_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["apply", "discard"] },
    replacement: { description: "Optional full memory text to write instead of the proposal", type: "string" },
  },
  required: ["decision"],
};

export type ChangeKind =
  | "requirement"
  | "scope"
  | "decision"
  | "lead"
  | "metric"
  | "date"
  | "dependency"
  | "system"
  | "interface"
  | "data"
  | "convention"
  | "other";

/** Tool gates: kind "gate", risk "low", auto-approved by policy. Keep them out of every queue. */
export const GATE_SCHEMA: JsonSchema = {
  type: "object",
  properties: { approved: { type: "boolean" }, note: { type: "string" } },
  required: ["approved"],
};

// ---------------------------------------------------------------------------------------------
// dev-plan [SPEC]  phases: Context → Plan 1..N
// ---------------------------------------------------------------------------------------------

/** A task as the planner proposes it (DeliveryTask without runtime fields). */
export interface PlannedTask {
  id: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  tags: string[];
  dependencies: string[];
  relatedFiles: string[];
  acceptanceCriteria: Array<{ id: string; text: string }>;
  epicId: string;
  type: "story" | "task" | "bug" | "spike";
  repo: string;
  size: "XS" | "S" | "M" | "L";
  team: string;
  wave: number;
  traces: string[];
  blockedBy?: string;
}

export interface DevPlanInput {
  projectId: string;
  brd: string;
  aad: string;
  out: string;
  notes: string[];
  epics: Array<{ id: string; key: string | null; title: string; brdRequirementRefs: string[]; aadRefs: string[]; systems: string[] }>;
  maxRounds: number;
}

export interface PlanReport {
  assumptions: string[];
  openQuestions: string[];
  uncovered: string[];
  risks: string[];
}

/**
 * Optional extras dev-plan adds to its report (output.report and the "plan report" attachment,
 * where each renders as its own section). Kept off PlanReport so views that list its keys still work.
 */
export interface PlanReportExtras {
  /** AAD systems marked Proposed or changed that no task works on. */
  uncoveredSystems?: string[];
  /** Developer notes the planner could not act on, so the developer knows to apply them by hand. */
  notesNotApplied?: string[];
}

export interface DevPlanOutput {
  path: string;
  approved: boolean;
  rounds: number;
  tasks: PlannedTask[];
  start: "all-waves" | "first-wave" | "manual";
  report: PlanReport;
}

/**
 * key "plan:review:<round>", kind "review", phase "Plan <round>".
 * question: `Round ${round}: review the implementation plan (${tasks} tasks in ${waves} waves, ${openQuestions} open questions). Edit it directly if you like, then approve it or ask for a revision.`
 * reviewSubject { kind: "file", path: out, mode: "edit" }; attachment "plan report" (markdown: Assumptions, Open questions, Requirements not covered by a task, Risks)
 * and "tasks" (application/json: PlannedTask[]).
 */
export interface PlanReviewAnswer {
  decision: "approve" | "revise";
  feedback?: string;
  newNotes?: string[];
  start?: "all-waves" | "first-wave" | "manual";
  /** The edited task list; replaces the proposal when present. */
  tasks?: PlannedTask[];
}
export const PLAN_REVIEW_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["approve", "revise"], description: "approve starts the agents; revise runs another planning round" },
    feedback: { default: "", description: "What to change in the next round", type: "string" },
    newNotes: { default: [], description: "Extra developer notes to add", type: "array", items: { type: "string" } },
    start: { type: "string", enum: ["all-waves", "first-wave", "manual"], default: "all-waves", description: "How agents start once the plan is approved" },
    tasks: { type: "array", description: "The edited task list; replaces the proposal", items: { type: "object" } },
  },
  required: ["decision"],
};

// ---------------------------------------------------------------------------------------------
// dev-task [SPEC]  phases: Prepare → Implement → Verify → Integrate → Review (→ Rework n → …)
// ---------------------------------------------------------------------------------------------

export interface DevTaskInput {
  projectId: string;
  task: PlannedTask & { jiraKey: string | null; branch: string };
  /** Run attempt number for this task (a QA loop-back starts attempt 2, 3, …). */
  attempt: number;
  /** Feedback carried into this run, e.g. QA bugs. */
  feedback?: string;
  /** Developer notes for this task: the stage's general notes plus the ones that name it. */
  notes?: string[];
  origin: "plan" | "qa";
  maxReworkCycles: number;
}

/** Output of the step with key `implement:<taskId>` (and `rework:<n>:<taskId>`). */
export interface ImplementStepOutput {
  summary: string;
  files: FileStat[];
  diffStats: { adds: number; dels: number; files: number };
}

export interface DevTaskOutput {
  taskId: string;
  approved: boolean;
  cancelled: boolean;
  escalated: boolean;
  reworkCycles: number;
  diffStats: { adds: number; dels: number; files: number };
  checks: CheckState[];
}

/**
 * key "task:review:<cycle>" (1-based), kind "review", phase "Review".
 * question: `Review ${taskKey}: ${title} (${passed}/${checks} checks passed, +${adds} −${dels} in ${files} files). Approve it or request changes.`
 * reviewSubject { kind: "artifact", mediaType: "text/x-diff", label: "changes" };
 * attachments "verification report" (markdown) and "agent summary" (markdown).
 * After maxReworkCycles the question is prefixed "Escalated: " and "cancel" is offered.
 */
export interface TaskReviewAnswer {
  decision: "approve" | "request-changes" | "cancel";
  feedback?: string;
}
export const TASK_REVIEW_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["approve", "request-changes"], description: "approve marks the task done; request-changes runs a rework cycle" },
    feedback: { default: "", description: "What the agent should change", type: "string" },
  },
  required: ["decision"],
};
export const TASK_REVIEW_ESCALATED_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["approve", "request-changes", "cancel"], description: "approve anyway, run one more rework, or cancel the task" },
    feedback: { default: "", description: "What the agent should change", type: "string" },
  },
  required: ["decision"],
};

// ---------------------------------------------------------------------------------------------
// qa-verify [SPEC]  phases: Test plan → Automated → Manual → Report → Certify
// ---------------------------------------------------------------------------------------------

export interface QaVerifyInput {
  projectId: string;
  task: PlannedTask & { jiraKey: string | null; branch: string };
  attempt: number;
  environment: string;
  /** The "Ready for test" handoff note written at the Implementation gate. */
  readyForTest?: string;
}

/** Evidence as a script produces it; the delivery store assigns ids/projectId/taskId/runId. */
export interface EvidenceDraft {
  kind: EvidenceKind;
  title: string;
  mediaType: string;
  url?: string;
  sizeBytes?: number;
  durationSec?: number;
  environment: string;
  build: string;
  mode: "automated" | "manual";
  testLevel?: "unit" | "api" | "e2e" | "manual";
  result: "pass" | "fail" | "inconclusive";
  criterionResults: Array<{ criterionId: string; result: "pass" | "fail" | "inconclusive"; detail?: string }>;
  command?: string;
  exitCode?: number;
  excerpt?: string;
  counts?: { passed: number; failed: number; skipped: number };
  segments?: Array<{ label: "BEFORE" | "AFTER" | "PARITY"; host: string; build: string }>;
  timeline?: Array<{ t: string; text: string }>;
  data?: unknown;
}

/** Output of the step with key "report" in qa-verify; the store attaches it before Certify. */
export interface QaReportStepOutput {
  evidence: EvidenceDraft[];
  criteria: Array<{ id: string; text: string; result: "pass" | "fail" | "inconclusive" }>;
  evidencePath: string;
}

export interface QaVerifyOutput {
  taskId: string;
  verdict: "ready-for-po-review" | "bugs-found" | "blocked";
  bugs: string[];
  comment: string;
}

/**
 * key "qa:review:<attempt>", kind "review", phase "Certify".
 * question: `QA ${taskKey}: ${met}/${total} acceptance criteria met, ${n} evidence items (${auto} automated, ${manual} manual). Certify it, report bugs, or mark it blocked.`
 * reviewSubject { kind: "file", path: ".deliver/evidence/<repo>/<KEY>.md", mode: "view" }; attachment "test plan" (markdown).
 */
export interface QaReviewAnswer {
  verdict: "ready-for-po-review" | "bugs-found" | "blocked";
  comment?: string;
  bugs?: string[];
}
export const QA_REVIEW_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    verdict: {
      anyOf: [
        { const: "ready-for-po-review", description: "All acceptance criteria met with evidence" },
        { const: "bugs-found", description: "At least one criterion fails; list the bugs" },
        { const: "blocked", description: "Cannot be tested yet" },
      ],
    },
    comment: { default: "", description: "Notes for the developer and the PO", type: "string" },
    bugs: { default: [], description: "One bug per line", type: "array", items: { type: "string" } },
  },
  required: ["verdict"],
};

export const WORKFLOW_IDS = ["po-brd", "architect-aad", "dev-plan", "dev-task", "qa-verify"] as const;
export type WorkflowId = (typeof WORKFLOW_IDS)[number];
