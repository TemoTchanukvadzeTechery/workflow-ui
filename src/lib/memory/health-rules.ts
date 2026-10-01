/**
 * Vault health (plan §3): the check catalogue, its thresholds and `evaluateHealth`, which turns
 * what health.ts gathered (snapshot notes, lint findings, git status, the index) into checks,
 * group points, a 0–100 score and a band. Pure and isomorphic: no fs, no spawn, and the clock is
 * a parameter. The Health tab imports the catalogue to explain the score.
 *
 * Scoring: a count check earns all of its weight on pass, half on warn and none on fail. A ratio
 * check earns its good/total share (all of it when no note is eligible); in Coverage it is never
 * worse than warn. Checks that could not run are skipped and the weights renormalise over the
 * rest. Caps: a fatal lint finding holds the score at 40, a missing index at 59.
 */
import {
  noteIdForPath,
  notePathForId,
  type MemoryBuildStats,
  type MemoryHealthAffected,
  type MemoryHealthBand,
  type MemoryHealthCheck,
  type MemoryHealthCheckId,
  type MemoryHealthCounts,
  type MemoryHealthGroup,
  type MemoryHealthGroupId,
  type MemoryHealthMeasure,
  type MemoryHealthStatus,
  type MemoryIndexState,
  type MemoryNoteType,
} from "./types";

// ---------------------------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------------------------

export const HEALTH_GROUPS: ReadonlyArray<{ id: MemoryHealthGroupId; weight: number }> = [
  { id: "integrity", weight: 35 },
  { id: "freshness", weight: 25 },
  { id: "coverage", weight: 25 },
  { id: "trust", weight: 15 },
];

/** count: pass/warn/fail earn 1/0.5/0. ratio: earns good/total. */
export type HealthCheckKind = "count" | "ratio";

export interface HealthCheckDef {
  id: MemoryHealthCheckId;
  group: MemoryHealthGroupId;
  weight: number;
  kind: HealthCheckKind;
}

/** Catalogue order: the payload's `checks` and the Health tab follow it. Weights sum to 100. */
export const HEALTH_CHECKS: readonly HealthCheckDef[] = [
  { id: "loads", group: "integrity", weight: 12, kind: "count" },
  { id: "lint", group: "integrity", weight: 8, kind: "count" },
  { id: "links", group: "integrity", weight: 8, kind: "count" },
  { id: "index", group: "integrity", weight: 7, kind: "count" },
  { id: "committed", group: "freshness", weight: 10, kind: "count" },
  { id: "stale-docs", group: "freshness", weight: 8, kind: "count" },
  { id: "recency", group: "freshness", weight: 7, kind: "ratio" },
  { id: "connected", group: "coverage", weight: 7, kind: "ratio" },
  { id: "owners", group: "coverage", weight: 6, kind: "ratio" },
  { id: "claims", group: "coverage", weight: 5, kind: "ratio" },
  { id: "sources", group: "coverage", weight: 4, kind: "ratio" },
  { id: "tags", group: "coverage", weight: 3, kind: "ratio" },
  { id: "seed-blocked", group: "trust", weight: 6, kind: "count" },
  { id: "proposed", group: "trust", weight: 5, kind: "count" },
  { id: "retired-deps", group: "trust", weight: 4, kind: "count" },
];

/**
 * Where pass turns into warn and warn into fail. A `*WarnShare` is the share of the population
 * (notes, document notes or claims) a count may reach and still only warn; at least 1 always warns.
 */
export const HEALTH_THRESHOLDS = {
  lintWarnShare: 0.1,
  linksWarnShare: 0.05,
  staleDocsWarnShare: 0.25,
  recencyDays: 180,
  recencyPass: 0.8,
  recencyWarn: 0.5,
  /** Coverage ratios pass from here; below it they warn, never fail. */
  coveragePass: 0.9,
  seedBlockedWarnShare: 0.1,
  proposedWarnShare: 0.25,
  retiredDepsWarnShare: 0.05,
  /** Score ceiling while a fatal lint finding stops the index from building. */
  capLoadsFail: 40,
  /** Score ceiling while the index is missing (most checks cannot run). */
  capIndexMissing: 59,
} as const;

/** Highest first: the first band whose `min` the score reaches. */
export const HEALTH_BANDS: ReadonlyArray<{ band: MemoryHealthBand; min: number }> = [
  { band: "excellent", min: 90 },
  { band: "good", min: 75 },
  { band: "fair", min: 50 },
  { band: "poor", min: 0 },
];

export function healthBand(score: number): MemoryHealthBand {
  return HEALTH_BANDS.find((b) => score >= b.min)?.band ?? "poor";
}

/** Lint rules whose findings abort an index build (the CLI's lint.mjs FATAL_RULES). */
export const FATAL_LINT_RULES: readonly string[] = ["frontmatter-required", "id-matches-path", "unique-id", "duplicate-block-id"];

const UNRESOLVED_LINK_RULE = "unresolved-link";

/** Notes that should name an owning team. */
export const OWNER_TYPES: readonly MemoryNoteType[] = ["system", "project", "decision", "convention", "kpi"];

/** Statuses a dependency should not have while the dependent note is still live. */
const GONE_STATUSES: ReadonlySet<string> = new Set(["retired", "deprecated"]);

/** Entries a check lists; `affectedTotal` carries the full count. */
const AFFECTED_MAX = 50;

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------------------------
// Note files (the CLI's vault-files.mjs)
// ---------------------------------------------------------------------------------------------

const ORG_NOTE_PATH = "plexus.md";

/**
 * Whether a vault-relative path is a file the CLI loads as a note (listVaultFiles in
 * vault-files.mjs): a `.md` file in any folder whose path segments do not start with `_` or `.`,
 * or `plexus.md` at the root. README.md, templates, bases, Obsidian settings and the index are not
 * notes. Wider than noteIdForPath: a nested or misnamed `.md` file still loads (and fails lint).
 */
export function isVaultNote(vaultRel: string): boolean {
  if (!vaultRel.endsWith(".md")) return false;
  const segments = vaultRel.split("/");
  if (segments.some((s) => s === "" || s.startsWith("_") || s.startsWith("."))) return false;
  return segments.length > 1 || vaultRel === ORG_NOTE_PATH;
}

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

export type HealthLintFinding = MemoryBuildStats["lint"][number];

/** One note as the checks see it (health.ts maps the snapshot into this). */
export interface HealthNote {
  id: string;
  type: MemoryNoteType;
  title: string;
  /** Vault-relative. */
  path: string;
  status: string | null;
  /** Frontmatter `updated`, `YYYY-MM-DD`. */
  updated: string;
  hasOwner: boolean;
  tagCount: number;
  sourceCount: number;
  claimCount: number;
  proposedClaims: number;
  /** Distinct in + out edges. */
  linkCount: number;
  /** The `seed_blocked` value (e.g. "secret"), or null. */
  seedBlocked: string | null;
  /** Ids of the notes its `depends_on` resolves to. */
  dependsOn: string[];
}

/** A signed-off document whose file drifted from its accepted sha. */
export interface HealthStaleDoc {
  /** The document note id. */
  document: string;
  /** Workspace-relative path of the signed-off file. */
  path: string;
  title: string | null;
  /** Claims that cite it. */
  claims: number;
}

export type HealthFileChange = "added" | "modified" | "deleted" | "renamed" | "untracked";

/** A note file that differs from HEAD. */
export interface HealthUncommittedFile {
  /** Vault-relative. */
  path: string;
  change: HealthFileChange;
  /** Renames: the vault-relative path before. */
  oldPath: string | null;
}

export interface HealthInput {
  /** Note files on disk (the fs walk); the population when the snapshot is missing. */
  noteCount: number;
  /** Null when the snapshot was not read (index missing or building) or failed. */
  notes: HealthNote[] | null;
  /** From the snapshot; null with it. */
  staleDocs: HealthStaleDoc[] | null;
  /** Null when lint could not run. */
  lint: HealthLintFinding[] | null;
  index: { state: MemoryIndexState; embeddings: MemoryBuildStats["embeddings"] | null };
  /** Null when git is unavailable or failed. */
  uncommitted: HealthUncommittedFile[] | null;
  /** Why an input is missing; shown on the checks it skips. */
  reasons?: { snapshot?: string; lint?: string; git?: string };
}

export interface HealthEvaluation {
  score: number | null;
  band: MemoryHealthBand | null;
  counts: MemoryHealthCounts;
  /** The four groups in catalogue order. */
  groups: MemoryHealthGroup[];
  /** Catalogue order. */
  checks: MemoryHealthCheck[];
  /** At least one check was skipped. */
  partial: boolean;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const DEFS: ReadonlyMap<MemoryHealthCheckId, HealthCheckDef> = new Map(HEALTH_CHECKS.map((d) => [d.id, d]));

const COUNT_SCORE: Record<Exclude<MemoryHealthStatus, "skipped">, number> = { pass: 1, warn: 0.5, fail: 0 };

const form = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** How many a count may reach and still only warn: a share of the population, at least 1. */
function warnLimit(share: number, population: number): number {
  return Math.max(1, Math.floor(share * population));
}

function countStatus(n: number, warnMax: number): Exclude<MemoryHealthStatus, "skipped"> {
  return n === 0 ? "pass" : n <= warnMax ? "warn" : "fail";
}

interface CheckBody {
  status: Exclude<MemoryHealthStatus, "skipped">;
  /** Ratio checks pass their good/total share; count checks leave it out (the status decides). */
  score?: number;
  measure: MemoryHealthMeasure;
  affected?: MemoryHealthAffected[];
  note?: string;
}

function evaluated(id: MemoryHealthCheckId, body: CheckBody): MemoryHealthCheck {
  const def = DEFS.get(id)!;
  const all = body.affected ?? [];
  return {
    id,
    group: def.group,
    status: body.status,
    weight: def.weight,
    score: body.score ?? COUNT_SCORE[body.status],
    measure: body.measure,
    affected: all.slice(0, AFFECTED_MAX),
    affectedTotal: all.length,
    ...(body.note ? { note: body.note } : {}),
  };
}

function skipped(id: MemoryHealthCheckId, reason: string): MemoryHealthCheck {
  const def = DEFS.get(id)!;
  return { id, group: def.group, status: "skipped", weight: def.weight, score: null, measure: { value: 0, of: null, summary: "Not checked" }, affected: [], affectedTotal: 0, note: reason };
}

const byTitle = (a: HealthNote, b: HealthNote) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
/** Most-connected first: the notes whose gap matters most, then by title. */
const byReach = (a: HealthNote, b: HealthNote) => b.linkCount - a.linkCount || byTitle(a, b);

function noteEntry(n: HealthNote, detail: string): MemoryHealthAffected {
  return { id: n.id, title: n.title, path: n.path, detail };
}

function findingEntry(f: HealthLintFinding, titles: ReadonlyMap<string, string>, withRule: boolean): MemoryHealthAffected {
  const id = noteIdForPath(f.path);
  const at = f.line !== undefined ? ` (line ${f.line})` : "";
  return { id, title: id ? (titles.get(id) ?? null) : null, path: f.path, detail: `${withRule ? `${f.rule}: ` : ""}${f.message}${at}` };
}

/** `YYYY-MM-DD` at UTC midnight, or NaN. */
function parseDay(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
}

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------

function lintChecks(lint: HealthLintFinding[] | null, population: number, titles: ReadonlyMap<string, string>, reason: string): MemoryHealthCheck[] {
  if (lint === null) return [skipped("loads", reason), skipped("lint", reason), skipped("links", reason)];
  const fatal = lint.filter((f) => FATAL_LINT_RULES.includes(f.rule));
  const unresolved = lint.filter((f) => f.rule === UNRESOLVED_LINK_RULE);
  const other = lint.filter((f) => f.rule !== UNRESOLVED_LINK_RULE && !FATAL_LINT_RULES.includes(f.rule));
  return [
    evaluated("loads", {
      status: fatal.length === 0 ? "pass" : "fail",
      measure: {
        value: fatal.length,
        of: null,
        summary: fatal.length === 0 ? "Every note loads" : `${fatal.length} fatal lint ${form(fatal.length, "finding stops", "findings stop")} the index build`,
      },
      affected: fatal.map((f) => findingEntry(f, titles, true)),
    }),
    evaluated("lint", {
      status: countStatus(other.length, warnLimit(HEALTH_THRESHOLDS.lintWarnShare, population)),
      measure: { value: other.length, of: null, summary: other.length === 0 ? "No lint findings" : `${other.length} lint ${form(other.length, "finding", "findings")}` },
      affected: other.map((f) => findingEntry(f, titles, true)),
    }),
    evaluated("links", {
      status: countStatus(unresolved.length, warnLimit(HEALTH_THRESHOLDS.linksWarnShare, population)),
      measure: {
        value: unresolved.length,
        of: null,
        summary: unresolved.length === 0 ? "Every link resolves" : `${unresolved.length} ${form(unresolved.length, "link does", "links do")} not resolve`,
      },
      affected: unresolved.map((f) => findingEntry(f, titles, false)),
    }),
  ];
}

function indexCheck(index: HealthInput["index"]): MemoryHealthCheck {
  if (index.state === "building") return skipped("index", "The search index is building");
  if (index.state === "missing") {
    return evaluated("index", { status: "fail", measure: { value: 0, of: null, summary: "The search index has not been built" } });
  }
  if (index.embeddings === "off" || index.embeddings === "unavailable") {
    return evaluated("index", {
      status: "warn",
      measure: { value: 1, of: null, summary: index.embeddings === "off" ? "Built; embeddings are off" : "Built; embeddings could not load" },
      note: "Search falls back to keyword matching without embeddings.",
    });
  }
  return evaluated("index", {
    status: "pass",
    measure: { value: 1, of: null, summary: index.embeddings === "on" ? "Built, with embeddings" : "Built" },
    ...(index.embeddings === null ? { note: "Whether embeddings are on is known after the next index build." } : {}),
  });
}

const CHANGE_DETAIL: Record<HealthFileChange, string> = {
  added: "added, not committed",
  modified: "modified, not committed",
  deleted: "deleted, not committed",
  renamed: "renamed, not committed",
  untracked: "new file, not tracked",
};

function committedCheck(files: HealthUncommittedFile[] | null, titles: ReadonlyMap<string, string>, reason: string): MemoryHealthCheck {
  if (files === null) return skipped("committed", reason);
  const n = files.length;
  return evaluated("committed", {
    status: n === 0 ? "pass" : "warn",
    measure: { value: n, of: null, summary: n === 0 ? "Every note is committed" : `${n} ${form(n, "note has", "notes have")} uncommitted changes` },
    affected: files.map((f) => {
      const id = noteIdForPath(f.path);
      const detail = f.change === "renamed" && f.oldPath ? `renamed from ${f.oldPath}, not committed` : CHANGE_DETAIL[f.change];
      return { id: f.change === "deleted" ? null : id, title: id ? (titles.get(id) ?? null) : null, path: f.path, detail };
    }),
  });
}

function staleDocsCheck(stale: HealthStaleDoc[] | null, notes: HealthNote[] | null, reason: string): MemoryHealthCheck {
  if (stale === null || notes === null) return skipped("stale-docs", reason);
  const docs = notes.filter((n) => n.type === "document").length;
  const n = stale.length;
  return evaluated("stale-docs", {
    status: countStatus(n, warnLimit(HEALTH_THRESHOLDS.staleDocsWarnShare, docs)),
    measure: {
      value: n,
      of: docs,
      summary: n === 0 ? (docs === 0 ? "No signed-off documents yet" : "Every signed-off document matches") : `${n} of ${docs} signed-off ${form(docs, "document", "documents")} drifted`,
    },
    affected: [...stale]
      .sort((a, b) => b.claims - a.claims || a.document.localeCompare(b.document))
      .map((d) => ({
        id: d.document,
        title: d.title,
        path: notePathForId(d.document),
        detail: `${d.path} changed after sign-off${d.claims > 0 ? `; ${d.claims} ${form(d.claims, "claim cites", "claims cite")} it` : ""}`,
      })),
  });
}

function recencyCheck(notes: HealthNote[], now: number): MemoryHealthCheck {
  const horizon = now - HEALTH_THRESHOLDS.recencyDays * DAY_MS;
  const old = notes
    .map((n) => ({ n, t: parseDay(n.updated) }))
    .filter(({ t }) => !(t >= horizon))
    // Undated first, then oldest first.
    .sort((a, b) => (Number.isNaN(a.t) || Number.isNaN(b.t) ? Number(!Number.isNaN(a.t)) - Number(!Number.isNaN(b.t)) : a.t - b.t) || byTitle(a.n, b.n));
  const total = notes.length;
  const fresh = total - old.length;
  const ratio = total === 0 ? 1 : fresh / total;
  const status = ratio >= HEALTH_THRESHOLDS.recencyPass ? "pass" : ratio >= HEALTH_THRESHOLDS.recencyWarn ? "warn" : "fail";
  return evaluated("recency", {
    status,
    score: ratio,
    measure: { value: fresh, of: total, summary: `${fresh} of ${total} ${form(total, "note", "notes")} updated in the last ${HEALTH_THRESHOLDS.recencyDays} days` },
    affected: old.map(({ n, t }) => noteEntry(n, Number.isNaN(t) ? "no valid updated date" : `updated ${n.updated}`)),
  });
}

/** A Coverage ratio: the share of eligible notes that have something; never worse than warn. */
function coverageCheck(
  id: MemoryHealthCheckId,
  eligible: HealthNote[],
  has: (n: HealthNote) => boolean,
  missing: string,
  summary: (good: number, total: number) => string,
): MemoryHealthCheck {
  const without = eligible.filter((n) => !has(n)).sort(byReach);
  const total = eligible.length;
  const good = total - without.length;
  const ratio = total === 0 ? 1 : good / total;
  return evaluated(id, {
    status: ratio >= HEALTH_THRESHOLDS.coveragePass ? "pass" : "warn",
    score: ratio,
    measure: { value: good, of: total, summary: summary(good, total) },
    affected: without.map((n) => noteEntry(n, missing)),
  });
}

const ofNotes = (good: number, total: number, one: string, many: string) => `${good} of ${total} ${form(total, "note", "notes")} ${form(good, one, many)}`;

function coverageChecks(notes: HealthNote[]): MemoryHealthCheck[] {
  const notDocs = notes.filter((n) => n.type !== "document");
  return [
    coverageCheck("connected", notes, (n) => n.linkCount > 0, "no connections", (g, t) => ofNotes(g, t, "has a connection", "have a connection")),
    coverageCheck(
      "owners",
      notes.filter((n) => OWNER_TYPES.includes(n.type)),
      (n) => n.hasOwner,
      "no owner",
      (g, t) => (t === 0 ? "No notes need an owner" : ofNotes(g, t, "has an owner", "have an owner")),
    ),
    coverageCheck("claims", notDocs, (n) => n.claimCount > 0, "no claims", (g, t) => ofNotes(g, t, "has claims", "have claims")),
    coverageCheck("sources", notDocs, (n) => n.sourceCount > 0, "no sources", (g, t) => ofNotes(g, t, "cites a source", "cite a source")),
    coverageCheck("tags", notes, (n) => n.tagCount > 0, "no tags", (g, t) => ofNotes(g, t, "is tagged", "are tagged")),
  ];
}

function trustChecks(notes: HealthNote[]): MemoryHealthCheck[] {
  const total = notes.length;
  const byId = new Map(notes.map((n) => [n.id, n]));

  const blocked = notes.filter((n) => n.seedBlocked !== null).sort(byReach);
  const seed = evaluated("seed-blocked", {
    status: countStatus(blocked.length, warnLimit(HEALTH_THRESHOLDS.seedBlockedWarnShare, total)),
    measure: {
      value: blocked.length,
      of: total,
      summary: blocked.length === 0 ? "No seed stubs" : `${blocked.length} ${form(blocked.length, "note is a seed stub", "notes are seed stubs")}`,
    },
    affected: blocked.map((n) => noteEntry(n, `seed_blocked: ${n.seedBlocked}`)),
  });

  const claims = notes.reduce((sum, n) => sum + n.claimCount, 0);
  const proposedNotes = notes.filter((n) => n.proposedClaims > 0).sort((a, b) => b.proposedClaims - a.proposedClaims || byTitle(a, b));
  const proposedCount = proposedNotes.reduce((sum, n) => sum + n.proposedClaims, 0);
  const proposed = evaluated("proposed", {
    status: countStatus(proposedCount, warnLimit(HEALTH_THRESHOLDS.proposedWarnShare, claims)),
    measure: {
      value: proposedCount,
      of: claims,
      summary: proposedCount === 0 ? "No proposed claims" : `${proposedCount} of ${claims} ${form(claims, "claim", "claims")} ${form(proposedCount, "is", "are")} proposed`,
    },
    affected: proposedNotes.map((n) => noteEntry(n, `${n.proposedClaims} proposed ${form(n.proposedClaims, "claim", "claims")}`)),
  });

  const dependents = notes
    .filter((n) => !GONE_STATUSES.has(n.status ?? ""))
    .map((n) => ({ n, gone: n.dependsOn.map((id) => byId.get(id)).filter((d): d is HealthNote => !!d && GONE_STATUSES.has(d.status ?? "")) }))
    .filter(({ gone }) => gone.length > 0)
    .sort((a, b) => b.gone.length - a.gone.length || byTitle(a.n, b.n));
  const retired = evaluated("retired-deps", {
    status: countStatus(dependents.length, warnLimit(HEALTH_THRESHOLDS.retiredDepsWarnShare, total)),
    measure: {
      value: dependents.length,
      of: null,
      summary:
        dependents.length === 0
          ? "No live note depends on a retired one"
          : `${dependents.length} live ${form(dependents.length, "note depends", "notes depend")} on retired or deprecated notes`,
    },
    affected: dependents.map(({ n, gone }) => noteEntry(n, `depends on ${gone.map((d) => `${d.title} (${d.status})`).join(", ")}`)),
  });

  return [seed, proposed, retired];
}

// ---------------------------------------------------------------------------------------------
// evaluateHealth
// ---------------------------------------------------------------------------------------------

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Every check in catalogue order, the group points, the score after caps and its band. */
export function evaluateHealth(input: HealthInput, now: number): HealthEvaluation {
  const { notes } = input;
  const titles: ReadonlyMap<string, string> = new Map((notes ?? []).map((n) => [n.id, n.title]));
  const population = notes?.length ?? input.noteCount;
  const snapshotReason = input.reasons?.snapshot ?? "The vault snapshot could not be read";

  const byId = new Map<MemoryHealthCheckId, MemoryHealthCheck>();
  const add = (list: MemoryHealthCheck[]) => list.forEach((c) => byId.set(c.id, c));
  add(lintChecks(input.lint, population, titles, input.reasons?.lint ?? "Lint could not run"));
  add([indexCheck(input.index)]);
  add([committedCheck(input.uncommitted, titles, input.reasons?.git ?? "git is unavailable")]);
  add([staleDocsCheck(input.staleDocs, notes, snapshotReason)]);
  if (notes) {
    add([recencyCheck(notes, now)]);
    add(coverageChecks(notes));
    add(trustChecks(notes));
  } else {
    for (const id of ["recency", "connected", "owners", "claims", "sources", "tags", "seed-blocked", "proposed", "retired-deps"] as const) add([skipped(id, snapshotReason)]);
  }
  const checks = HEALTH_CHECKS.map((d) => byId.get(d.id)!);

  const counts: MemoryHealthCounts = { pass: 0, warn: 0, fail: 0, skipped: 0 };
  for (const c of checks) counts[c.status] += 1;

  const groups: MemoryHealthGroup[] = HEALTH_GROUPS.map(({ id }) => {
    const inGroup = checks.filter((c) => c.group === id && c.score !== null);
    return {
      id,
      earned: round1(inGroup.reduce((sum, c) => sum + c.weight * (c.score ?? 0), 0)),
      possible: inGroup.reduce((sum, c) => sum + c.weight, 0),
    };
  });

  let earned = 0;
  let possible = 0;
  for (const c of checks) {
    if (c.score === null) continue;
    earned += c.weight * c.score;
    possible += c.weight;
  }
  let score = possible === 0 ? null : Math.round((100 * earned) / possible);
  if (score !== null && byId.get("loads")?.status === "fail") score = Math.min(score, HEALTH_THRESHOLDS.capLoadsFail);
  if (score !== null && input.index.state === "missing") score = Math.min(score, HEALTH_THRESHOLDS.capIndexMissing);

  return { score, band: score === null ? null : healthBand(score), counts, groups, checks, partial: counts.skipped > 0 };
}
