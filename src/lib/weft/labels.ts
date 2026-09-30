/**
 * Status labels, tones and icons for every status-like enum the UI shows. Status is never
 * color-only: each meta carries an icon and a text label, and "live" states pulse instead of
 * showing an icon. Tones map to the --status-<tone>-fg/-bg tokens in globals.css (SPEC 5.3).
 * Isomorphic and hook-free, so server components and client components can both use it.
 */
import {
  AppWindow,
  BadgeCheck,
  Ban,
  Bot,
  Bug,
  Check,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleX,
  Eye,
  FileText,
  Folder,
  GitBranch,
  Globe,
  History,
  Hourglass,
  Link2,
  ListChecks,
  Lock,
  MessageCircleQuestion,
  Minus,
  OctagonPause,
  PencilLine,
  Radio,
  RotateCcw,
  ShieldCheck,
  SquareTerminal,
  Terminal,
  Timer,
  TriangleAlert,
  UserRound,
  Variable,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type {
  Decision,
  DeliveryTaskStatus,
  DocumentArtifact,
  EpicStatus,
  Evidence,
  Health,
  InboxItem,
  InboxTier,
  MemoryStatus,
  QaTaskStatus,
  StageId,
  StageStatus,
  TraceRow,
} from "@/lib/delivery/types";
import type { HumanKind, HumanStatus, Risk, RunStatus, StepKind, StepStatus } from "./types";

/** running = cobalt, attention = amber (needs a human), review = violet (awaiting approval),
 *  success = green, danger = red, neutral = grey (locked, not started, cancelled). */
export type Tone = "running" | "attention" | "review" | "success" | "danger" | "neutral";

export const TONES: readonly Tone[] = ["running", "attention", "review", "success", "danger", "neutral"];

export interface StatusMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
  /** Live state: render a pulsing dot instead of the icon. */
  pulse?: boolean;
}

const m = (label: string, tone: Tone, icon: LucideIcon, pulse?: boolean): StatusMeta => (pulse ? { label, tone, icon, pulse } : { label, tone, icon });

// ---------------------------------------------------------------------------------------------
// Weft
// ---------------------------------------------------------------------------------------------

/** Labels from weft/docs/information-architecture.md (brief A.1). */
const RUN: Record<RunStatus, StatusMeta> = {
  planning: m("Planning", "running", Hourglass, true),
  executing: m("Running", "running", Zap, true),
  waiting_for_human: m("Needs your input", "attention", CircleAlert),
  waiting_for_signal: m("Waiting for signal", "running", Radio),
  integrating: m("Integrating", "running", GitBranch, true),
  verifying: m("Verifying", "running", ListChecks, true),
  complete: m("Complete", "success", CircleCheck),
  failed: m("Failed", "danger", CircleX),
  cancelled: m("Cancelled", "neutral", Ban),
};
export const runStatusMeta = (s: RunStatus): StatusMeta => RUN[s] ?? unknownMeta(s);

const STEP: Record<StepStatus, StatusMeta> = {
  running: m("Running", "running", Zap, true),
  ok: m("Done", "success", Check),
  failed: m("Failed", "danger", CircleX),
};
export const stepStatusMeta = (s: StepStatus): StatusMeta => STEP[s] ?? unknownMeta(s);

const HUMAN_STATUS: Record<HumanStatus, StatusMeta> = {
  pending: m("Waiting", "attention", CircleAlert),
  answered: m("Answered", "success", Check),
  superseded: m("Superseded", "neutral", History),
};
export const humanStatusMeta = (s: HumanStatus): StatusMeta => HUMAN_STATUS[s] ?? unknownMeta(s);

/** Human request kinds. Policy gates are neutral: they never reach a person. */
const HUMAN_KIND: Record<HumanKind, StatusMeta> = {
  gate: m("Tool gate", "neutral", ShieldCheck),
  ask: m("Question", "attention", MessageCircleQuestion),
  approve: m("Approval", "attention", CircleCheck),
  review: m("Review", "attention", Eye),
  confirm: m("Confirmation", "attention", CircleAlert),
};
export const humanKindMeta = (k: HumanKind): StatusMeta => HUMAN_KIND[k] ?? unknownMeta(k);

const RISK: Record<Risk, StatusMeta> = {
  low: m("Low risk", "neutral", ShieldCheck),
  medium: m("Medium risk", "attention", TriangleAlert),
  high: m("High risk", "danger", TriangleAlert),
  irreversible: m("Irreversible", "danger", CircleAlert),
};
export const riskMeta = (r: Risk): StatusMeta => RISK[r] ?? unknownMeta(r);

/** Step kinds: label is the uppercase ledger kind (weft RailStepRow), tone is always neutral. */
const STEP_KIND: Record<StepKind, StatusMeta> = {
  agent: m("agent", "neutral", Bot),
  human: m("human", "neutral", UserRound),
  workflow: m("workflow", "neutral", Workflow),
  git: m("git", "neutral", GitBranch),
  exec: m("exec", "neutral", Terminal),
  bash: m("bash", "neutral", SquareTerminal),
  fetch: m("fetch", "neutral", Globe),
  fs: m("fs", "neutral", Folder),
  env: m("env", "neutral", Variable),
  check: m("check", "neutral", ListChecks),
  sleep: m("sleep", "neutral", Timer),
  signal: m("signal", "neutral", Radio),
  ui: m("ui", "neutral", AppWindow),
  sideeffect: m("side effect", "neutral", Zap),
};
export const stepKindMeta = (k: StepKind): StatusMeta => STEP_KIND[k] ?? unknownMeta(k);

// ---------------------------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------------------------

const STAGE: Record<StageStatus, StatusMeta> = {
  locked: m("Locked", "neutral", Lock),
  not_started: m("Not started", "neutral", CircleDashed),
  in_progress: m("In progress", "running", Zap, true),
  needs_input: m("Needs input", "attention", CircleAlert),
  in_review: m("Awaiting approval", "review", Eye),
  approved: m("Approved", "success", CircleCheck),
  failed: m("Failed", "danger", CircleX),
};
export const stageStatusMeta = (s: StageStatus): StatusMeta => STAGE[s] ?? unknownMeta(s);

const TASK: Record<DeliveryTaskStatus, StatusMeta> = {
  proposed: m("Proposed", "neutral", CircleDashed),
  ready: m("Ready", "neutral", CircleDashed),
  in_progress: m("In progress", "running", Zap, true),
  verifying: m("Verifying", "running", ListChecks, true),
  in_review: m("In review", "review", Eye),
  changes_requested: m("Changes requested", "danger", RotateCcw),
  // Only a developer approval sets "done", so the word is earned here.
  done: m("Done", "success", CircleCheck),
  blocked: m("Blocked", "attention", OctagonPause),
  cancelled: m("Cancelled", "neutral", Ban),
};
export const taskStatusMeta = (s: DeliveryTaskStatus): StatusMeta => TASK[s] ?? unknownMeta(s);

const QA: Record<QaTaskStatus, StatusMeta> = {
  pending: m("Not tested", "neutral", CircleDashed),
  testing: m("Testing", "running", ListChecks, true),
  in_review: m("In review", "review", Eye),
  certified: m("Certified", "success", BadgeCheck),
  bugs_found: m("Bugs found", "danger", Bug),
  blocked: m("Blocked", "attention", OctagonPause),
};
export const qaStatusMeta = (s: QaTaskStatus): StatusMeta => QA[s] ?? unknownMeta(s);

const EPIC: Record<EpicStatus, StatusMeta> = {
  draft: m("Draft", "neutral", PencilLine),
  accepted: m("Accepted", "success", Check),
  synced: m("In Jira", "success", Link2),
};
export const epicStatusMeta = (s: EpicStatus): StatusMeta => EPIC[s] ?? unknownMeta(s);

export type DocStatus = DocumentArtifact["status"];
const DOC: Record<DocStatus, StatusMeta> = {
  draft: m("Draft", "neutral", PencilLine),
  accepted: m("Accepted", "success", CircleCheck),
  superseded: m("Superseded", "neutral", History),
};
export const docStatusMeta = (s: DocStatus): StatusMeta => DOC[s] ?? unknownMeta(s);

const MEMORY: Record<MemoryStatus, StatusMeta> = {
  updated: m("Memory updated", "success", Check),
  discarded: m("Memory discarded", "attention", Ban),
  unchanged: m("Memory unchanged", "neutral", Minus),
  skipped: m("Memory skipped", "neutral", Minus),
};
export const memoryStatusMeta = (s: MemoryStatus): StatusMeta => MEMORY[s] ?? unknownMeta(s);

export type EvidenceResult = Evidence["result"];
const EVIDENCE: Record<EvidenceResult, StatusMeta> = {
  pass: m("Pass", "success", Check),
  fail: m("Fail", "danger", CircleX),
  inconclusive: m("Inconclusive", "attention", CircleHelp),
};
export const evidenceResultMeta = (r: EvidenceResult): StatusMeta => EVIDENCE[r] ?? unknownMeta(r);

export type TraceVerdict = TraceRow["verdict"];
const TRACE: Record<TraceVerdict, StatusMeta> = {
  met: m("Met", "success", CircleCheck),
  missing: m("Missing", "danger", CircleX),
  needs_manual_check: m("Needs manual check", "attention", CircleHelp),
  waived: m("Waived", "neutral", Minus),
};
export const traceVerdictMeta = (v: TraceVerdict): StatusMeta => TRACE[v] ?? unknownMeta(v);

const HEALTH: Record<Health, StatusMeta> = {
  on_track: m("On track", "success", CircleCheck),
  at_risk: m("At risk", "attention", TriangleAlert),
  off_track: m("Off track", "danger", CircleX),
};
export const healthMeta = (h: Health): StatusMeta => HEALTH[h] ?? unknownMeta(h);

export type DecisionKind = Decision["decision"];
const DECISION: Record<DecisionKind, StatusMeta> = {
  approved: m("Approved", "success", CircleCheck),
  changes_requested: m("Changes requested", "danger", RotateCcw),
};
export const decisionMeta = (d: DecisionKind): StatusMeta => DECISION[d] ?? unknownMeta(d);

const INBOX_TIER: Record<InboxTier, StatusMeta> = {
  blocking_run: m("Blocking a run", "attention", CircleAlert),
  awaiting_approval: m("Awaiting approval", "review", Eye),
  fyi: m("FYI", "neutral", FileText),
};
export const inboxTierMeta = (t: InboxTier): StatusMeta => INBOX_TIER[t] ?? unknownMeta(t);

// ---------------------------------------------------------------------------------------------
// One entry point for StatusPill / StatusDot
// ---------------------------------------------------------------------------------------------

/** A typed reference to any status the UI renders: `<StatusPill status={{ kind: "run", value }} />`. */
export type StatusRef =
  | { kind: "run"; value: RunStatus }
  | { kind: "step"; value: StepStatus }
  | { kind: "human"; value: HumanStatus }
  | { kind: "humanKind"; value: HumanKind }
  | { kind: "risk"; value: Risk }
  | { kind: "stage"; value: StageStatus }
  | { kind: "task"; value: DeliveryTaskStatus }
  | { kind: "qa"; value: QaTaskStatus }
  | { kind: "epic"; value: EpicStatus }
  | { kind: "doc"; value: DocStatus }
  | { kind: "memory"; value: MemoryStatus }
  | { kind: "evidence"; value: EvidenceResult }
  | { kind: "trace"; value: TraceVerdict }
  | { kind: "health"; value: Health }
  | { kind: "decision"; value: DecisionKind }
  | { kind: "inbox"; value: InboxTier };

export function statusMeta(ref: StatusRef): StatusMeta {
  switch (ref.kind) {
    case "run":
      return runStatusMeta(ref.value);
    case "step":
      return stepStatusMeta(ref.value);
    case "human":
      return humanStatusMeta(ref.value);
    case "humanKind":
      return humanKindMeta(ref.value);
    case "risk":
      return riskMeta(ref.value);
    case "stage":
      return stageStatusMeta(ref.value);
    case "task":
      return taskStatusMeta(ref.value);
    case "qa":
      return qaStatusMeta(ref.value);
    case "epic":
      return epicStatusMeta(ref.value);
    case "doc":
      return docStatusMeta(ref.value);
    case "memory":
      return memoryStatusMeta(ref.value);
    case "evidence":
      return evidenceResultMeta(ref.value);
    case "trace":
      return traceVerdictMeta(ref.value);
    case "health":
      return healthMeta(ref.value);
    case "decision":
      return decisionMeta(ref.value);
    case "inbox":
      return inboxTierMeta(ref.value);
  }
}

/**
 * A project's headline status: its current stage's status, or "Done" once the PO signed off.
 * Accepts a ProjectSummary or anything with the same three fields.
 */
export function projectStatusMeta(p: { done: boolean; currentStage: StageId; stageStatuses: Record<StageId, StageStatus> }): StatusMeta {
  if (p.done) return m("Done", "success", BadgeCheck);
  return stageStatusMeta(p.stageStatuses[p.currentStage] ?? "not_started");
}

/** One-line text for an inbox item (command palette, notifications, compact lists). */
export function inboxItemText(item: InboxItem): string {
  switch (item.kind) {
    case "human":
      return firstLine(item.entry.question);
    case "stage-gate":
      return item.title;
    case "epics":
      return `${item.count} ${item.count === 1 ? "epic" : "epics"} to accept`;
    case "action":
      return item.title;
    case "notice":
      return item.text;
  }
}

function firstLine(s: string, max = 120): string {
  const line = s.split("\n").find((l) => l.trim()) ?? s;
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}...` : line;
}

/** Unknown values (a newer daemon, a typo in seed data) still render, humanized and neutral. */
function unknownMeta(value: string): StatusMeta {
  const label = String(value).replace(/[_-]+/g, " ");
  return { label: label.charAt(0).toUpperCase() + label.slice(1), tone: "neutral", icon: CircleDashed };
}
