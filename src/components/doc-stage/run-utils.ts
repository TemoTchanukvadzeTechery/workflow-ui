/**
 * Pure helpers shared by the Stage 1 (po-brd) and Stage 2 (architect-aad) workspaces: which run
 * and document a stage shows, which human requests are open, the weft phase list, discovery
 * counters and the friendly ledger lines. No React here, so the views stay thin.
 */
import type { AadReport, Actor, DocumentArtifact, DraftReport, ProjectBundle, StageView } from "@/lib/delivery/types";
import type { HumanState, RunDetail, StepState } from "@/lib/weft/types";
import { TERMINAL_RUN_STATUSES } from "@/lib/weft/types";
import type { DocWorkflowOutput } from "@/lib/weft/workflows";

export type DocKind = "brd" | "aad";
export type DocStageId = "requirements" | "architecture";

export const DOC_LABEL: Record<DocKind, "BRD" | "AAD"> = { brd: "BRD", aad: "AAD" };
export const DOC_WORKFLOW: Record<DocKind, "po-brd" | "architect-aad"> = { brd: "po-brd", aad: "architect-aad" };

/** The stage's document: the one its record points at, else the newest of that kind. */
export function stageDoc(bundle: ProjectBundle, kind: DocKind): DocumentArtifact | undefined {
  const id = kind === "brd" ? bundle.project.stages.requirements.brdDocId : bundle.project.stages.architecture.aadDocId;
  return bundle.documents.find((d) => d.id === id) ?? [...bundle.documents].reverse().find((d) => d.kind === kind);
}

/** Runs of the stage for its document workflow, oldest first. */
export function docRuns(view: StageView, kind: DocKind): StageView["runs"] {
  return view.runs.filter((r) => r.workflow === DOC_WORKFLOW[kind]).sort((a, b) => a.createdAt - b.createdAt);
}

export function latestDocRun(view: StageView, kind: DocKind): StageView["runs"][number] | undefined {
  return docRuns(view, kind).at(-1);
}

export const isTerminal = (status: string | undefined) => !!status && (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);

/** Open, non-gate human requests of a run, oldest first. */
export function pendingHumans(run: RunDetail | undefined): HumanState[] {
  return (run?.humans ?? []).filter((h) => h.status === "pending" && h.kind !== "gate").sort((a, b) => a.seq - b.seq);
}

export function humansWithPrefix(run: RunDetail | undefined, prefix: string): HumanState[] {
  return (run?.humans ?? []).filter((h) => h.kind !== "gate" && (h.key ?? "").startsWith(prefix)).sort((a, b) => a.seq - b.seq);
}

/** The sub-step a request key belongs to. */
export function stepForKey(key: string | undefined): "discovery" | "drafts" | "memory" | undefined {
  if (!key) return undefined;
  if (key.startsWith("deps:review")) return "discovery";
  if (key.startsWith("memory:review")) return "memory";
  if (key.startsWith("review:")) return "drafts";
  return undefined;
}

export function runOutput<R = DraftReport | AadReport>(run: RunDetail | undefined): DocWorkflowOutput<R> | undefined {
  if (!run || run.status !== "complete" || !run.output || typeof run.output !== "object") return undefined;
  return run.output as DocWorkflowOutput<R>;
}

export function runInput(run: RunDetail | undefined): { maxRounds?: number; discover?: boolean; discoveryRounds?: number; maxQueries?: number; request?: string; notes?: string[]; seeds?: string[]; brd?: string } {
  return (run?.input && typeof run.input === "object" ? run.input : {}) as ReturnType<typeof runInput>;
}

export function hasPhase(run: RunDetail | undefined, test: RegExp): boolean {
  return !!run?.phases.some((p) => test.test(p.name));
}

/** Markdown for DraftReportTabs, built exactly like the workflow's review attachment. */
export function reportMarkdown(kind: DocKind, r: DraftReport | AadReport): string {
  const section = (title: string, items: readonly string[] | undefined) => `## ${title}\n\n${items && items.length > 0 ? items.map((i) => `- ${i}`).join("\n") : "- none"}`;
  if (kind === "brd") {
    return [
      section("Blocking questions", r.blockingQuestions),
      section("Conflicts, including with documents in memory", r.conflicts),
      section("Sections not yet provided", r.missingSections),
      section("Instructions found in sources and ignored", r.ignoredInstructions),
      section("Changes in this round", r.changes),
    ].join("\n\n");
  }
  const a = r as AadReport;
  return [
    section("Blocking questions", a.blockingQuestions),
    section("Decisions needed", a.decisionsNeeded),
    section("BRD requirements not traced", a.untracedRequirements),
    section("Conflicts", a.conflicts),
    section("Sections not yet provided", a.missingSections),
    section("Instructions found in sources and ignored", a.ignoredInstructions),
    section("Changes in this round", a.changes),
  ].join("\n\n");
}

// ---------------------------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------------------------

export type PhaseState = "done" | "current" | "waiting" | "failed" | "future" | "skipped";
export interface PhaseItem {
  name: string;
  state: PhaseState;
}

const BASE_PHASES = ["Preflight", "Memory", "Discover"];

/** Preflight → Memory → Discover → Draft 1..N → Update memory, with the ones not reached yet greyed. */
export function phaseItems(run: RunDetail | undefined): PhaseItem[] {
  const seen = (run?.phases ?? []).map((p) => p.name);
  const drafts = seen.filter((n) => /^Draft \d+$/.test(n));
  const planned = [...BASE_PHASES, ...(drafts.length ? drafts : ["Draft 1"]), "Update memory"];
  const names = [...planned, ...seen.filter((n) => !planned.includes(n))];
  const terminal = isTerminal(run?.status);
  const last = seen.at(-1);
  const waiting = run?.status === "waiting_for_human";
  const lastSeenIdx = Math.max(-1, ...seen.map((n) => names.indexOf(n)));
  return names.map((name, idx) => {
    if (!seen.includes(name)) {
      // Not reached: skipped when the run is over or already past it (e.g. discover: false), else still ahead.
      return { name, state: terminal || idx < lastSeenIdx ? "skipped" : "future" };
    }
    if (name !== last) return { name, state: "done" };
    if (run?.status === "failed" || run?.status === "cancelled") return { name, state: "failed" };
    if (terminal) return { name, state: "done" };
    return { name, state: waiting ? "waiting" : "current" };
  });
}

/** The phase the run is in right now, e.g. "Draft 2". */
export function currentPhase(run: RunDetail | undefined): string | undefined {
  return run?.phases.at(-1)?.name;
}

// ---------------------------------------------------------------------------------------------
// Discovery counters and ledger
// ---------------------------------------------------------------------------------------------

const FETCH_KEY = /^atl:fetch:(.+?)(?:@\d+)?$/;
const SEARCH_KEY = /^atl:(\d+):\d+(?:@\d+)?$/;
const DISCOVER_KEY = /^discover:(\d+)(?:@\d+)?$/;

export interface DiscoveryCounters {
  fetched: number;
  searches: number;
  rejected: number;
  planner: number;
}

/**
 * An exec step whose command ran but exited non-zero. weft records the step as ok (the command
 * ran), so the failure is only in `output.exitCode`: e.g. `atl jira issue get LEGAL-77` → 1 (404).
 */
export function execFailed(s: StepState): boolean {
  if (s.kind !== "exec" || s.status !== "ok") return false;
  const code = (s.output as { exitCode?: unknown } | undefined)?.exitCode;
  return typeof code === "number" && code !== 0;
}

/** "404" from atl's "… (404)" error text, else "exit 1". */
function execFailureNote(s: StepState): string {
  const out = s.output as { exitCode?: unknown; stderr?: unknown; stdout?: unknown } | undefined;
  const text = `${typeof out?.stderr === "string" ? out.stderr : ""} ${typeof out?.stdout === "string" ? out.stdout : ""}`;
  const http = /\((\d{3})\)\s*$/.exec(text.trim())?.[1];
  return http ?? `exit ${String(out?.exitCode ?? "?")}`;
}

/**
 * Sources fetched = distinct refs of `atl:fetch:<ref>` steps that ran and exited 0 (a 404 is not a
 * source). Searches = `atl:<round>:<i>` exec steps. Rejected = queries a planner round proposed
 * (capped at maxQueries) that never became an exec step (the workflow drops commands outside the
 * atl allowlist), counted once the round is over.
 */
export function discoveryCounters(run: RunDetail | undefined): DiscoveryCounters {
  if (!run) return { fetched: 0, searches: 0, rejected: 0, planner: 0 };
  const maxQueries = runInput(run).maxQueries ?? 6;
  const fetched = new Set<string>();
  let searches = 0;
  let rejected = 0;
  let planner = 0;
  const steps = [...run.steps].sort((a, b) => a.seq - b.seq);
  const execByRound = new Map<number, number>();
  for (const s of steps) {
    const key = s.key ?? "";
    const f = FETCH_KEY.exec(key);
    if (f?.[1] && s.status === "ok" && !execFailed(s)) fetched.add(f[1]);
    const q = SEARCH_KEY.exec(key);
    if (q?.[1]) {
      searches++;
      execByRound.set(Number(q[1]), (execByRound.get(Number(q[1])) ?? 0) + 1);
    }
  }
  steps.forEach((s, i) => {
    const d = DISCOVER_KEY.exec(s.key ?? "");
    if (!d?.[1] || s.kind !== "agent") return;
    planner++;
    if (s.status !== "ok") return;
    const round = Number(d[1]);
    const out = s.output as { queries?: unknown[]; done?: boolean } | undefined;
    const proposed = Math.min(Array.isArray(out?.queries) ? out.queries.length : 0, maxQueries);
    // The round is over once a later step that is not one of its searches exists.
    const closed = steps.slice(i + 1).some((later) => {
      const m = SEARCH_KEY.exec(later.key ?? "");
      return !m || Number(m[1]) !== round;
    }) || isTerminal(run.status) || run.status === "waiting_for_human";
    if (closed) rejected += Math.max(0, proposed - (execByRound.get(round) ?? 0));
  });
  return { fetched: fetched.size, searches, rejected, planner };
}

export interface LedgerLine {
  seq: number;
  /** "warn": the step ran but its command failed (non-zero exit), e.g. a 404 fetch. */
  status: StepState["status"] | "waiting" | "warn";
  text: string;
  meta?: string;
  startedAt: number;
  endedAt?: number;
  usd?: number;
}

function atlSummary(label: string): { verb: "fetch" | "search"; text: string } | undefined {
  const cmd = label.replace(/^atl\s+/, "").replace(/\s+--no-input\s+--no-color\s*$/, "");
  const get = /^(?:jira issue get|confluence page get)\s+(\S+)/.exec(cmd);
  if (get?.[1]) return { verb: "fetch", text: get[1] };
  const jql = /^jira issue list\s+(.*?)(?:\s+--limit\s+\d+)?(?:\s+-o\s+\w+)?$/.exec(cmd);
  if (jql) return { verb: "search", text: `Jira search: ${jql[1] || "recent issues"}` };
  const cql = /^confluence search\s+(.*?)(?:\s+--limit\s+\d+)?(?:\s+-o\s+\w+)?$/.exec(cmd);
  if (cql) return { verb: "search", text: `Confluence search: ${cql[1]}` };
  if (/^jira project ls/.test(cmd)) return { verb: "search", text: "Listing Jira projects" };
  if (/^confluence space ls/.test(cmd)) return { verb: "search", text: "Listing Confluence spaces" };
  return undefined;
}

/** The ref an exec step fetches: `atl:fetch:<ref>`, or a planner search that is a plain `… get <ref>`. */
function fetchedRef(s: StepState): string | undefined {
  const f = FETCH_KEY.exec(s.key ?? "")?.[1];
  if (f) return f;
  if (s.kind !== "exec" || !SEARCH_KEY.test(s.key ?? "") || !(s.label ?? "").startsWith("atl ")) return undefined;
  const a = atlSummary(s.label ?? "");
  return a?.verb === "fetch" ? a.text : undefined;
}

/**
 * One friendly line per meaningful step ("Fetching CP-50908…"); stat/snapshot noise is dropped.
 * Planner rounds are numbered across the whole run ("search round 2"); "pass" is kept for the
 * human dependency reviews (deps:review:<pass>).
 */
export function describeStep(s: StepState, docLabel: string): string | undefined {
  const key = s.key ?? "";
  const label = s.label ?? key;
  const running = s.status === "running";
  const failed = s.status === "failed";
  const bad = execFailed(s);
  const fetch = FETCH_KEY.exec(key);
  if (fetch?.[1]) return running ? `Fetching ${fetch[1]}…` : failed || bad ? `Could not fetch ${fetch[1]}${bad ? ` (${execFailureNote(s)})` : ""}` : `Fetched ${fetch[1]}`;
  if (s.kind === "exec" && label.startsWith("atl ")) {
    const a = atlSummary(label);
    const round = SEARCH_KEY.exec(key)?.[1];
    const pre = round ? `Search round ${round} · ` : "";
    if (a?.verb === "fetch") return running ? `${pre}Looking up ${a.text}…` : failed || bad ? `${pre}Could not look up ${a.text}${bad ? ` (${execFailureNote(s)})` : ""}` : `${pre}Looked up ${a.text}`;
    if (a) return `${pre}${a.text}${running ? "…" : failed || bad ? ` · failed${bad ? ` (${execFailureNote(s)})` : ""}` : ""}`;
    return label;
  }
  const disc = DISCOVER_KEY.exec(key);
  if (disc?.[1]) {
    const out = s.output as { queries?: unknown[]; done?: boolean } | undefined;
    const n = Array.isArray(out?.queries) ? out.queries.length : 0;
    if (running) return `Search round ${disc[1]}: the planner is choosing searches…`;
    return `Search round ${disc[1]} planned · ${n} ${n === 1 ? "search" : "searches"}${out?.done ? " · planner done" : ""}`;
  }
  const draft = /^draft:(\d+)/.exec(key);
  if (draft && s.kind === "agent") return running ? `Writing ${docLabel} round ${draft[1]}…` : failed ? `${docLabel} round ${draft[1]} failed` : `${docLabel} round ${draft[1]} written`;
  const integ = /^integrate:draft:(\d+)(?:@\d+)?$/.exec(key);
  if (integ) return running ? `Integrating round ${integ[1]}…` : `Round ${integ[1]} merged into the workspace`;
  if (/^integrate:(snapshot|apply):/.test(key)) return undefined;
  if (/^memory:propose/.test(key)) return running ? "Proposing a shared-memory update…" : "Shared-memory update proposed";
  if (/^memory:write/.test(key)) return running ? "Writing memory/memory.md…" : "memory/memory.md written";
  if (s.kind === "fs") {
    const read = /^read:(.+?)(?:@\d+)?$/.exec(key);
    if (read?.[1]) return running ? `Reading ${read[1]}…` : `Read ${read[1]}`;
    return undefined; // stat:… noise
  }
  if (s.kind === "git") return running ? "Reading git history…" : "git log";
  return label || undefined;
}

function waitingText(key: string | undefined, docLabel: string): string | undefined {
  const n = /:(\d+)$/.exec(key ?? "")?.[1];
  if (key?.startsWith("deps:review:")) return `confirm the dependencies (review pass ${n})`;
  if (key?.startsWith("review:")) return `review ${docLabel} round ${n}`;
  if (key?.startsWith("memory:review")) return "review the memory update";
  return undefined;
}

/** Phases of the discovery part of a run (the Discovery sub-step shows only these). */
export const DISCOVERY_PHASES = /^(Preflight|Memory|Discover)/;

function lineStatus(s: StepState): LedgerLine["status"] {
  return execFailed(s) ? "warn" : s.status;
}

/**
 * The friendly ledger, oldest first (all of it; the caller shows the tail). A planner search that
 * looks up a ref and the later `atl:fetch:<ref>` of that same ref are one line: it sits where the
 * look-up happened and carries the fetch's outcome ("Search round 2 · Fetched CS-1182").
 */
export function ledgerLines(run: RunDetail | undefined, docLabel: string, phases?: RegExp): LedgerLine[] {
  if (!run) return [];
  const lines: LedgerLine[] = [];
  const lookups = new Map<string, number>();
  for (const s of [...run.steps].sort((a, b) => a.seq - b.seq)) {
    if (phases && s.phase && !phases.test(s.phase)) continue;
    const text = describeStep(s, docLabel);
    if (!text) continue;
    const ref = fetchedRef(s);
    const isFetch = !!FETCH_KEY.exec(s.key ?? "");
    const at = ref && isFetch ? lookups.get(ref) : undefined;
    const prior = at !== undefined ? lines[at] : undefined;
    if (prior && ref) {
      const round = SEARCH_KEY.exec(run.steps.find((x) => x.seq === prior.seq)?.key ?? "")?.[1];
      lines[at!] = {
        ...prior,
        status: lineStatus(s),
        text: `${round ? `Search round ${round} · ` : ""}${text}`,
        ...(s.status === "running" ? { startedAt: s.startedAt, endedAt: undefined } : {}),
        usd: (prior.usd ?? 0) + (s.usage?.usd ?? 0) || undefined,
      };
      lookups.delete(ref);
      continue;
    }
    if (ref && !isFetch) lookups.set(ref, lines.length);
    lines.push({ seq: s.seq, status: lineStatus(s), text, startedAt: s.startedAt, endedAt: s.endedAt, usd: s.usage?.usd });
  }
  for (const h of pendingHumans(run)) {
    if (phases && !(h.key ?? "").startsWith("deps:review")) continue;
    lines.push({ seq: h.seq, status: "waiting", text: `Waiting on you: ${waitingText(h.key, docLabel) ?? h.key ?? h.kind}`, startedAt: h.requestedAt });
  }
  lines.sort((a, b) => a.seq - b.seq);
  return lines;
}

/** Refs of a confirmed pass: the pass detail minus removed plus added. */
export interface PassSummary {
  pass: number;
  status: HumanState["status"];
  found: number;
  decision?: "continue" | "search-more";
  added: string[];
  removed: string[];
  guidance?: string;
  answeredAt?: number;
  human: HumanState;
}

export function passSummaries(run: RunDetail | undefined): PassSummary[] {
  return humansWithPrefix(run, "deps:review:").map((h) => {
    const pass = Number(/:(\d+)$/.exec(h.key ?? "")?.[1] ?? 1);
    const found = Number(/(\d+) dependenc/.exec(h.question)?.[1] ?? 0);
    const a = (h.answer ?? {}) as { decision?: "continue" | "search-more"; add?: string[]; remove?: string[]; guidance?: string };
    return {
      pass,
      status: h.status,
      found,
      ...(a.decision ? { decision: a.decision } : {}),
      added: a.add ?? [],
      removed: a.remove ?? [],
      ...(a.guidance ? { guidance: a.guidance } : {}),
      human: h,
    };
  });
}

/** The round of a review key or of the last Draft phase. */
export function reviewRound(run: RunDetail | undefined): number | undefined {
  const pending = pendingHumans(run).find((h) => (h.key ?? "").startsWith("review:"));
  const fromKey = pending ? Number(/:(\d+)$/.exec(pending.key ?? "")?.[1]) : undefined;
  if (fromKey) return fromKey;
  const draft = [...(run?.phases ?? [])].reverse().find((p) => /^Draft \d+$/.test(p.name));
  return draft ? Number(draft.name.slice(6)) : undefined;
}

/** The feedback of the last answered review:<round> (carried into "Start another run" as a note). */
export function lastReviewFeedback(run: RunDetail | undefined): { round: number; feedback: string } | undefined {
  const answered = humansWithPrefix(run, "review:").filter((h) => h.status === "answered");
  for (const h of [...answered].reverse()) {
    const fb = (h.answer as { feedback?: unknown } | undefined)?.feedback;
    if (typeof fb === "string" && fb.trim()) return { round: Number(/:(\d+)$/.exec(h.key ?? "")?.[1] ?? 0), feedback: fb.trim() };
  }
  return undefined;
}

/** Why a stage whose document was already produced needs revising: it was reopened, or it went stale. */
export interface RevisionCause {
  kind: "reopened" | "stale";
  /** The reopen comment, or the stale reason ("Requirements was reopened: …"). */
  comment: string;
  at: number;
  by?: Actor;
}

/** The newest reopen / stale mark of a stage that is not approved (again) yet. */
export function revisionCause(record: { approvedAt?: number; stale?: { since: number; reason: string }; reopened?: Array<{ at: number; by: Actor; comment: string }> }): RevisionCause | undefined {
  if (record.approvedAt) return undefined;
  const r = record.reopened?.at(-1);
  const s = record.stale;
  if (s && (!r || s.since >= r.at)) return { kind: "stale", comment: s.reason, at: s.since };
  if (r) return { kind: "reopened", comment: r.comment, at: r.at, by: r.by };
  return undefined;
}

/** Whether the document got a new version (run draft, edit or import) after the reopen / stale mark. */
export function revisedSince(doc: DocumentArtifact | undefined, cause: RevisionCause | undefined): boolean {
  if (!doc || !cause) return false;
  return doc.versions.some((v) => v.at > cause.at);
}

/**
 * Whether the stage can start a new document run: the last one ended without an accepted
 * document, or the stage was reopened / is stale (`revising`) and no run is still open. A run that
 * is still loading (`run` undefined while `lastStatus` is open) never counts.
 */
export function canStartAnother(run: RunDetail | undefined, opts: { revising?: boolean; lastStatus?: string } = {}): boolean {
  const status = run?.status ?? opts.lastStatus;
  if (status !== undefined && !isTerminal(status)) return false;
  if (!run) return !!opts.revising && (opts.lastStatus === undefined || isTerminal(opts.lastStatus));
  if (run.status === "failed" || run.status === "cancelled") return true;
  return run.status === "complete" && (runOutput(run)?.accepted === false || !!opts.revising);
}
