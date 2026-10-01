/**
 * The delivery layer: projects, stages, epics, tasks, evidence and activity. Weft has no project
 * concept, so a project only stores the weft runIds it started; every human-in-the-loop step is a
 * weft HumanState answered through POST /api/weft/runs/:id/answer. Only stage gates, epics, notes,
 * imports and project creation are delivery-layer operations.
 *
 * [REAL] = matches weft/po-workspace today (Stages 1–2). [SPEC] = invented for Stages 3–5, shaped
 * like a future weft workflow so a real one can replace the mock later.
 */
import type { CheckState, HumanKind, PendingEntry, RunStatus } from "@/lib/weft/types";

// ---------------------------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------------------------

/** Also the URL slugs: /projects/[projectId]/[stage]. */
export type StageId = "requirements" | "architecture" | "implementation" | "qa" | "signoff";
export type RoleLabel = "Product Owner" | "Architect" | "Developer" | "QA";

export interface StageDef {
  id: StageId;
  n: 1 | 2 | 3 | 4 | 5;
  title: string;
  short: string;
  owner: RoleLabel;
  /** Weft workflows this stage runs. */
  workflows: readonly string[];
  /** lucide-react icon name. Stages carry no color of their own: color always means status. */
  icon: "FileText" | "Network" | "Code2" | "FlaskConical" | "BadgeCheck";
  real: boolean;
}

export const STAGES: readonly StageDef[] = [
  { id: "requirements", n: 1, title: "Requirements", short: "BRD", owner: "Product Owner", workflows: ["po-brd"], icon: "FileText", real: true },
  { id: "architecture", n: 2, title: "Architecture", short: "AAD", owner: "Architect", workflows: ["architect-aad"], icon: "Network", real: true },
  { id: "implementation", n: 3, title: "Implementation", short: "Build", owner: "Developer", workflows: ["dev-plan", "dev-task"], icon: "Code2", real: false },
  { id: "qa", n: 4, title: "QA Certification", short: "QA", owner: "QA", workflows: ["qa-verify"], icon: "FlaskConical", real: false },
  { id: "signoff", n: 5, title: "PO Review", short: "Sign-off", owner: "Product Owner", workflows: [], icon: "BadgeCheck", real: false },
] as const;

export const STAGE_IDS: readonly StageId[] = STAGES.map((s) => s.id);

export function stageDef(id: StageId): StageDef {
  const def = STAGES.find((s) => s.id === id);
  if (!def) throw new Error(`unknown stage ${id}`);
  return def;
}

export function isStageId(value: string): value is StageId {
  return (STAGE_IDS as readonly string[]).includes(value);
}

export type StageStatus = "locked" | "not_started" | "in_progress" | "needs_input" | "in_review" | "approved" | "failed";

/** Sub-steps shown as pill tabs in each stage workspace. */
export type RequirementsStep = "intake" | "discovery" | "drafts" | "memory" | "epics";
export type ArchitectureStep = "brief" | "discovery" | "drafts" | "memory" | "epics";
export type ImplementationStep = "notes" | "planning" | "plan_review" | "executing" | "complete";
export type QaStep = "tasks" | "traceability" | "changes" | "final";

// ---------------------------------------------------------------------------------------------
// Actors and decisions
// ---------------------------------------------------------------------------------------------

/**
 * No roles yet: anyone can act on anything, but every decision records who made it. The client
 * sends the "Acting as" name in the `x-actor` header on every request.
 */
export type Actor =
  | { kind: "human"; name: string }
  | { kind: "agent"; name: string; model?: string }
  | { kind: "policy" }
  | { kind: "system" };

export interface Decision {
  id: string;
  decision: "approved" | "changes_requested";
  by: Actor;
  at: number;
  comment?: string;
  /** Warnings the approver ticked through, e.g. "4 blocking questions remain". */
  acknowledgedWarnings?: string[];
}

export interface StageNote {
  id: string;
  text: string;
  by: Actor;
  at: number;
  /** e.g. { docId, section: "Requirements", quote: "…" } renders as "[BRD §Requirements] …". */
  anchor?: { docId: string; section?: string; quote?: string };
  /** The run that consumed this note (sent as note text). */
  sentToRunId?: string;
  /**
   * Every run that received this note, oldest first. Implementation notes go to each dev-task run
   * they apply to, so one note can reach several runs; sentToRunId stays the first of them.
   */
  sentToRunIds?: string[];
}

// ---------------------------------------------------------------------------------------------
// Intake (Stage 1 and 2 run inputs) [REAL]
// ---------------------------------------------------------------------------------------------

/**
 * Requirement channels. The user chose Jira + Confluence (po-brd `seeds`) plus notes (po-brd
 * `notes`: repo-relative file paths or inline text). Nothing else is offered.
 */
export type RequirementSourceKind = "jira" | "confluence" | "note-file" | "note-text";

export interface RequirementSource {
  id: string;
  kind: RequirementSourceKind;
  /** Display label, e.g. "CP-50908" or "Customer notification preferences". */
  label: string;
  /** "CP-50908" | "48213377" | "notes/examples/reorder-reminders.md" | inline note text. */
  value: string;
  /** jira/confluence → seeds; note-file/note-text → notes. */
  mapsTo: "seeds" | "notes";
  addedBy: Actor;
  addedAt: number;
}

export interface RunOptions {
  /** 1–5, default 3. */
  maxRounds: number;
  /** Search Jira & Confluence first. Default true. */
  discover: boolean;
  /** 1–5, default 2. */
  discoveryRounds: number;
  /** atl commands per discovery round, 1–10, default 6. */
  maxQueries: number;
  /** Run option, not workflow input: "$8" for BRD, "$10" for AAD. */
  budget?: string;
}

export const DEFAULT_BRD_OPTIONS: RunOptions = { maxRounds: 3, discover: true, discoveryRounds: 2, maxQueries: 6, budget: "$8" };
export const DEFAULT_AAD_OPTIONS: RunOptions = { maxRounds: 3, discover: true, discoveryRounds: 2, maxQueries: 6, budget: "$10" };

export interface Intake {
  /** Becomes po-brd `input.request`. */
  request: string;
  sources: RequirementSource[];
  options: RunOptions;
}

// ---------------------------------------------------------------------------------------------
// Project and stage records
// ---------------------------------------------------------------------------------------------

export interface ImportRecord {
  docId: string;
  source: "paste" | "confluence";
  /** Confluence page id or URL when source is "confluence". */
  ref?: string;
  by: Actor;
  at: number;
}

interface StageBase {
  startedAt?: number;
  approvedAt?: number;
  decisions: Decision[];
  notes: StageNote[];
  /** Weft runs started for this stage, oldest first. */
  runIds: string[];
  /** Set when an earlier stage was reopened after this one had progressed. */
  stale?: { since: number; reason: string };
  reopened?: Array<{ at: number; by: Actor; comment: string; fromStage: StageId }>;
  /** The stage's document was imported instead of generated by a run. */
  imported?: ImportRecord;
}

export interface RequirementsStage extends StageBase {
  brdDocId?: string;
  epicsAcceptedAt?: number;
}

export interface ArchitectureStage extends StageBase {
  /** Becomes architect-aad `input.request`. */
  request: string;
  sources: RequirementSource[];
  options: RunOptions;
  aadDocId?: string;
  epicUpdatesAcceptedAt?: number;
}

export interface ImplementationStage extends StageBase {
  step: ImplementationStep;
  /** dev-plan runs (runIds holds dev-task runs too; this is the plan subset). */
  planRunIds: string[];
  planDocId?: string;
  planApprovedAt?: number;
  startMode?: "all-waves" | "first-wave" | "manual";
  /** Markdown "Ready for test" handoff note written at the gate. */
  readyForTestNote?: string;
}

export interface QaStage extends StageBase {
  step: QaStep;
}

export type SignoffStage = StageBase;

export interface Project {
  /** URL slug, e.g. "agreement-reporting". */
  id: string;
  /** Short key, e.g. "AGR". */
  key: string;
  name: string;
  summary: string;
  /** Jira project the mock "Create in Jira" uses, e.g. "CP". */
  jiraProject: string;
  createdAt: number;
  updatedAt: number;
  createdBy: Actor;
  currentStage: StageId;
  done: boolean;
  doneAt?: number;
  /** Workspace paths the workflows write: brd/<id>.md, aad/<id>.md, plan/<id>.md. Memory is shared. */
  docPaths: { brd: string; aad: string; plan: string };
  intake: Intake;
  stages: {
    requirements: RequirementsStage;
    architecture: ArchitectureStage;
    implementation: ImplementationStage;
    qa: QaStage;
    signoff: SignoffStage;
  };
}

export type Health = "on_track" | "at_risk" | "off_track";

// ---------------------------------------------------------------------------------------------
// Documents (BRD / AAD / memory / plan / ready-for-test)
// ---------------------------------------------------------------------------------------------

/** A dependency confirmed at the discovery review, cited as R1, R2, … [REAL] */
export interface Dependency {
  id: string;
  ref: string;
  kind: "jira" | "confluence";
  relation: string;
  title: string;
  why?: string;
}

/** po-brd lib/index.ts DraftReport. [REAL] */
export interface DraftReport {
  path: string;
  missingSections: string[];
  blockingQuestions: string[];
  conflicts: string[];
  ignoredInstructions: string[];
  changes: string[];
}

/** architect-aad lib/index.ts AadReport. [REAL] */
export interface AadReport extends DraftReport {
  untracedRequirements: string[];
  decisionsNeeded: string[];
}

export type MemoryStatus = "updated" | "discarded" | "unchanged" | "skipped";

export interface DocVersion {
  n: number;
  sha256: string;
  /** Blob holding this version's text (GET /api/weft/blobs/:ref?as=text). */
  blob: string;
  at: number;
  source: "agent" | "human-edit" | "import";
  runId?: string;
  /** e.g. "review:1". */
  roundKey?: string;
  /** e.g. "Regenerated after your feedback". */
  reason?: string;
}

/** A numbered BRD requirement, parsed from the BRD "Requirements" list: BR-1, BR-2, … */
export interface BrdRequirement {
  id: string;
  text: string;
  candidate?: boolean;
}

/** An AAD functional requirement row: FR1 … traced to BR ids. */
export interface AadRequirement {
  id: string;
  text: string;
  traces: string[];
  designElement?: string;
}

export type DocumentKind = "brd" | "aad" | "memory" | "plan" | "ready-for-test";

export interface DocumentArtifact {
  id: string;
  projectId: string;
  kind: DocumentKind;
  title: string;
  path: string;
  status: "draft" | "accepted" | "superseded";
  versions: DocVersion[];
  acceptedBy?: Actor;
  acceptedAt?: number;
  lastReport?: DraftReport | AadReport;
  dependencies: Dependency[];
  memory?: { status: MemoryStatus; major: boolean; changes: string[]; stale: string[] };
  requirements?: BrdRequirement[];
  frs?: AadRequirement[];
  /** Parsed "Open Questions" items (Q-n) of a BRD or AAD (optional addition; the server sends it). */
  openQuestions?: DocOpenQuestion[];
  /** AAD only: the High-Level Architecture system change table (optional addition). */
  systems?: DocSystemChange[];
  /** BRD only: Implementation Plan checklist items (optional addition). */
  implementationPlan?: string[];
}

export interface DocOpenQuestion {
  id: string;
  text: string;
  owner?: string;
}

export interface DocSystemChange {
  system: string;
  /** "Proposed", "No change proposed", "Explicitly not used", … */
  status: string;
  change: string;
  /** false for "No change" / "not used" rows. */
  changed: boolean;
}

// ---------------------------------------------------------------------------------------------
// Epics [SPEC — no weft workflow writes to Jira today; "Create in Jira" is mocked]
// ---------------------------------------------------------------------------------------------

export type EpicStatus = "draft" | "accepted" | "synced";

export interface EpicHistoryEntry {
  at: number;
  by: Actor;
  stage: StageId;
  change: string;
  before?: Partial<Pick<Epic, "title" | "objective" | "inScope" | "brdRequirementRefs" | "aadRefs" | "systems" | "designElements">>;
}

export interface Epic {
  id: string;
  projectId: string;
  /** null until the mock "Create in Jira" assigns one, e.g. "CP-52140". */
  key: string | null;
  title: string;
  objective: string;
  context: string;
  inScope: string[];
  /** ["BR-1", "BR-3"] */
  brdRequirementRefs: string[];
  /** ["FR3"] */
  aadRefs: string[];
  systems: string[];
  designElements: string[];
  status: EpicStatus;
  origin: StageId;
  changedIn?: "architecture";
  /** Open questions blocking it, e.g. ["Q3"]. */
  blockedBy?: string[];
  /** A discovered real epic this one hangs under, e.g. "CP-51709". */
  parentRef?: string;
  history: EpicHistoryEntry[];
}

// ---------------------------------------------------------------------------------------------
// Tasks [SPEC; core fields use weft WorkflowTask names]
// ---------------------------------------------------------------------------------------------

export type DeliveryTaskStatus =
  | "proposed"
  | "ready"
  | "in_progress"
  | "verifying"
  | "in_review"
  | "changes_requested"
  | "done"
  | "blocked"
  | "cancelled";

export type QaTaskStatus = "pending" | "testing" | "in_review" | "certified" | "bugs_found" | "blocked";

export interface AcceptanceCriterion {
  /** "AC-1", "AC-2", … */
  id: string;
  text: string;
  met: boolean;
  evidenceIds?: string[];
}

export interface DeliveryTask {
  /** "T-4" */
  id: string;
  projectId: string;
  /** "[customer-service-v2] Coverage endpoint" */
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  tags: string[];
  /** Task ids this one waits for. */
  dependencies: string[];
  relatedFiles: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  epicId: string;
  jiraKey: string | null;
  type: "story" | "task" | "bug" | "spike";
  repo: string;
  /** "feature-CP-52153-coverage-endpoint" */
  branch: string;
  size: "XS" | "S" | "M" | "L";
  team: string;
  wave: number;
  /** ["BR-3", "FR3"] */
  traces: string[];
  status: DeliveryTaskStatus;
  blockedBy?: string;
  /** dev-task runs, one per attempt, oldest first. */
  runIds: string[];
  reworkCount: number;
  /** Rework limit reached (maxReworkCycles: 2). */
  escalated: boolean;
  /** Where the latest rework request came from. */
  reworkFrom?: "developer" | "qa";
  lastFeedback?: string;
  devReview?: Decision;
  diffStats?: { adds: number; dels: number; files: number };
  checks: CheckState[];
  /** Live one-liner while an agent works: "Running check:unit". */
  latestStep?: string;
  startedAt?: number;
  finishedAt?: number;
  qa: {
    status: QaTaskStatus;
    runIds: string[];
    verdict?: "ready-for-po-review" | "bugs-found" | "blocked";
    review?: Decision;
    evidenceIds: string[];
    bugs: string[];
  };
}

// ---------------------------------------------------------------------------------------------
// Evidence [SPEC; mirrors the process docs and weft CheckEvidence]
// ---------------------------------------------------------------------------------------------

export type EvidenceKind = "video" | "screenshot" | "contact-sheet" | "log" | "test-report" | "command-output" | "data" | "metric";

export interface Evidence {
  id: string;
  projectId: string;
  taskId: string;
  runId?: string;
  kind: EvidenceKind;
  title: string;
  mediaType: string;
  /** Static placeholder under /mock/evidence/… */
  url?: string;
  sizeBytes?: number;
  durationSec?: number;
  environment: string;
  build: string;
  observedAt: number;
  mode: "automated" | "manual";
  testLevel?: "unit" | "api" | "e2e" | "manual";
  result: "pass" | "fail" | "inconclusive";
  criterionResults: Array<{ criterionId: string; result: "pass" | "fail" | "inconclusive"; detail?: string }>;
  command?: string;
  exitCode?: number;
  /** ≤ ~20 lines. */
  excerpt?: string;
  counts?: { passed: number; failed: number; skipped: number };
  segments?: Array<{ label: "BEFORE" | "AFTER" | "PARITY"; host: string; build: string }>;
  timeline?: Array<{ t: string; text: string }>;
  /** JSON payload for kind "data". */
  data?: unknown;
  producedBy: Actor;
  supersededBy?: string;
}

export interface TraceRow {
  brRef: string;
  brText: string;
  frRefs: string[];
  epicIds: string[];
  taskIds: string[];
  acIds: string[];
  automated: "pass" | "fail" | "none";
  manual: "pass" | "fail" | "none";
  evidenceCount: number;
  verdict: "met" | "missing" | "needs_manual_check" | "waived";
  waiver?: Decision;
}

export interface ChangeReview {
  id: string;
  projectId: string;
  kind: "code" | "memory" | "docs";
  /** Repo name, "memory/memory.md" or a doc path. */
  label: string;
  summary: string;
  files?: number;
  adds?: number;
  dels?: number;
  sourceRunIds: string[];
  consistent?: boolean;
  by?: Actor;
  at?: number;
  comment?: string;
}

// ---------------------------------------------------------------------------------------------
// Activity and inbox
// ---------------------------------------------------------------------------------------------

export type ActivityType =
  | "project.created"
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "human.requested"
  | "human.answered"
  | "gate.auto_approved"
  | "artifact.produced"
  | "artifact.accepted"
  | "artifact.imported"
  | "epic.proposed"
  | "epic.changed"
  | "epic.accepted"
  | "epic.synced"
  | "plan.approved"
  | "task.status"
  | "task.approved"
  | "task.changes_requested"
  | "evidence.attached"
  | "qa.verdict"
  | "stage.approved"
  | "stage.changes_requested"
  | "stage.reopened"
  | "note.added"
  | "project.done";

export interface Activity {
  id: string;
  projectId: string;
  stage: StageId;
  at: number;
  actor: Actor;
  type: ActivityType;
  /** "Architect accepted AAD v1" */
  text: string;
  href?: string;
  runId?: string;
  requestId?: string;
  taskId?: string;
}

export type InboxTier = "blocking_run" | "awaiting_approval" | "fyi";

export type InboxItem =
  | {
      kind: "human";
      tier: "blocking_run";
      id: string;
      projectId: string;
      projectName: string;
      stage: StageId;
      entry: PendingEntry;
      /** Joined from RunState.humans[] by id. */
      key?: string;
      phase?: string;
      taskId?: string;
      waitingMs: number;
      href: string;
    }
  | {
      kind: "stage-gate";
      tier: "awaiting_approval";
      id: string;
      projectId: string;
      projectName: string;
      stage: StageId;
      title: string;
      blockers: string[];
      warnings: string[];
      href: string;
      since: number;
    }
  | {
      kind: "epics";
      tier: "awaiting_approval";
      id: string;
      projectId: string;
      projectName: string;
      stage: "requirements" | "architecture";
      count: number;
      href: string;
      since: number;
    }
  | {
      kind: "action";
      tier: "awaiting_approval";
      id: string;
      projectId: string;
      projectName: string;
      stage: StageId;
      /** e.g. "Start the architecture run", "Generate the implementation plan". */
      title: string;
      href: string;
      since: number;
    }
  | {
      kind: "notice";
      tier: "fyi";
      id: string;
      projectId: string;
      projectName: string;
      stage: StageId;
      text: string;
      href: string;
      since: number;
      level: "info" | "warning" | "error";
    };

// ---------------------------------------------------------------------------------------------
// Read models returned by /api/delivery
// ---------------------------------------------------------------------------------------------

/** A gate blocker with a link to where it is resolved (a request, a sub-step, a task). */
export interface StageBlocker {
  text: string;
  href?: string;
}

export interface StageView {
  id: StageId;
  status: StageStatus;
  /** The gate button stays disabled while any blocker remains. */
  blockers: string[];
  /** The same blockers, in the same order, with links. */
  blockerItems?: StageBlocker[];
  /** Must be acknowledged with a checkbox at the gate; stored in Decision.acknowledgedWarnings. */
  warnings: string[];
  /** e.g. "7/9 tasks approved". */
  metric?: string;
  /** Current sub-step for the pill tabs. */
  step: string;
  /** Runs of this stage, newest last, with their status. */
  runs: Array<{ runId: string; workflow: string; status: RunStatus; createdAt: number; taskId?: string }>;
  /** Pending (non-policy) human requests on this stage's runs. */
  pending: number;
}

export interface ProjectSummary {
  id: string;
  key: string;
  name: string;
  summary: string;
  currentStage: StageId;
  stageStatuses: Record<StageId, StageStatus>;
  waitingCount: number;
  health: Health;
  /** Why health is not on track, from the rule that fired, e.g. "T-2 (CP-52335) escalated". */
  healthReason?: string;
  done: boolean;
  updatedAt: number;
  spendUsd: number;
  /** "Architect: AAD round 1 is waiting — 6 blocking questions". */
  nextStep?: string;
}

/** Everything a project page needs, in one payload: GET /api/delivery/projects/:id */
export interface ProjectBundle {
  project: Project;
  stages: Record<StageId, StageView>;
  health: Health;
  /** Why health is not on track (see ProjectSummary.healthReason). */
  healthReason?: string;
  nextStep?: { text: string; href: string; stage: StageId };
  spendUsd: number;
  documents: DocumentArtifact[];
  epics: Epic[];
  tasks: DeliveryTask[];
  evidence: Evidence[];
  trace: TraceRow[];
  changeReviews: ChangeReview[];
  inbox: InboxItem[];
  activity: Activity[];
}

export interface DashboardData {
  kpis: {
    activeProjects: number;
    doneProjects: number;
    waitingOnPeople: number;
    runsToday: number;
    agentsRunning: number;
    spend30d: number;
    tasksInFlight: number;
  };
  pipeline: Array<{ stage: StageId; total: number; inProgress: number; needsInput: number; inReview: number; approved: number }>;
  /** One point per day, oldest first, last 14 days. */
  spendSeries: Array<{ date: string; usd: number; runs: number }>;
  attention: InboxItem[];
  activity: Activity[];
  projects: ProjectSummary[];
}

export type DemoSpeed = "instant" | "fast" | "realistic";

export interface Settings {
  speed: DemoSpeed;
  /** "mock" serves /api/weft in-process; "weft" proxies to the daemon. */
  dataSource: "mock" | "weft";
  weftDaemon: string;
}

// ---------------------------------------------------------------------------------------------
// Request bodies for /api/delivery
// ---------------------------------------------------------------------------------------------

export interface CreateProjectBody {
  name: string;
  summary?: string;
  key?: string;
  jiraProject?: string;
  intake: Intake;
  /** Start the po-brd run right away (ignored when a BRD is imported). */
  start?: boolean;
  /**
   * Start mid-flow by importing existing documents instead of running their workflows: a BRD
   * (stage "requirements") and optionally an AAD (stage "architecture"). Each imported stage gets
   * an accepted document and proposed epics, then waits on its normal gate.
   */
  imports?: Array<ImportBody & { stage: "requirements" | "architecture" }>;
}

export interface ImportBody {
  content: string;
  source: "paste" | "confluence";
  ref?: string;
  title?: string;
}

export interface StartArchitectureBody {
  request: string;
  sources: RequirementSource[];
  options: RunOptions;
}

export interface StartPlanBody {
  notes?: string;
}

export interface DecisionBody {
  decision: "approved" | "changes_requested";
  comment?: string;
  acknowledgedWarnings?: string[];
  /** Implementation gate only: the edited Ready-for-test note (optional addition). */
  readyForTestNote?: string;
}

export interface ReopenBody {
  comment: string;
}

export interface NoteBody {
  stage: StageId;
  text: string;
  anchor?: StageNote["anchor"];
}

export type EpicUpsertBody = Partial<Pick<Epic, "title" | "objective" | "context" | "inScope" | "brdRequirementRefs" | "aadRefs" | "systems" | "designElements" | "parentRef" | "blockedBy">> & {
  id?: string;
};

export interface TaskStartBody {
  wave?: number;
  taskIds?: string[];
}

export type TaskPatchBody = Partial<
  Pick<DeliveryTask, "title" | "description" | "priority" | "repo" | "size" | "wave" | "dependencies" | "acceptanceCriteria" | "traces" | "status">
>;

export interface QaStartBody {
  taskIds?: string[];
}

export interface WaiveBody {
  comment: string;
}

export interface ChangeReviewBody {
  consistent: boolean;
  comment?: string;
}

// ---------------------------------------------------------------------------------------------
// Live updates: GET /api/events (SSE, event name "change", data = LiveEvent)
// ---------------------------------------------------------------------------------------------

export type LiveEvent =
  | { type: "run"; runId: string; projectId?: string; status?: RunStatus }
  | { type: "project"; projectId: string }
  | { type: "inbox" }
  | { type: "settings" }
  /** A memory vault note changed on disk (the vault watcher). */
  | { type: "memory" }
  | { type: "reset" }
  | {
      type: "notify";
      level: "info" | "attention" | "success" | "error";
      title: string;
      body?: string;
      href?: string;
      projectId?: string;
    };

/** Human request keys the UI renders with a bespoke form (falls back to SchemaForm). */
export const BESPOKE_REQUEST_PREFIXES = ["deps:review:", "review:", "memory:review", "plan:review:", "task:review:", "qa:review:"] as const;

export interface HumanRequestRef {
  runId: string;
  requestId: string;
  kind: HumanKind;
  key?: string;
}
