/**
 * Shared payload types for the memory vault viewer (/api/memory/*). The server side shells out to
 * po-workspace's memory CLI (tools/memory/CONTRACT.md); every shape that passes through from the
 * CLI is mirrored here exactly. Isomorphic: imported by server modules, route handlers and hooks.
 */

// ---------------------------------------------------------------------------------------------
// Note types and filter groups (CONTRACT §2.1)
// ---------------------------------------------------------------------------------------------

/** Folder ↔ type table from CONTRACT §2.1. The org note is `plexus.md` at the vault root. */
export const NOTE_TYPES = [
  { type: "org", folder: "" },
  { type: "project", folder: "projects" },
  { type: "system", folder: "systems" },
  { type: "team", folder: "teams" },
  { type: "stakeholder", folder: "stakeholders" },
  { type: "decision", folder: "decisions" },
  { type: "convention", folder: "conventions" },
  { type: "kpi", folder: "kpis" },
  { type: "glossary", folder: "glossary" },
  { type: "document", folder: "documents" },
] as const;

export type MemoryNoteType = (typeof NOTE_TYPES)[number]["type"];

export const MEMORY_NOTE_TYPES: readonly MemoryNoteType[] = NOTE_TYPES.map((t) => t.type);

const TYPE_SET: ReadonlySet<string> = new Set(MEMORY_NOTE_TYPES);

/** Ids look like `system/customer-service-v2` (`org/plexus` for the root note). */
const ID_RE = /^[a-z]+\/[a-z0-9-]+$/;

export function isMemoryNoteType(value: string): value is MemoryNoteType {
  return TYPE_SET.has(value);
}

/** Whether `id` is grammatically a note id (`<type>/<slug>` with a known type). */
export function isMemoryNoteId(id: string): boolean {
  return ID_RE.test(id) && isMemoryNoteType(id.split("/")[0]);
}

/** The overview filter groups (plan A3): every type belongs to exactly one group besides "all". */
export type MemoryTypeGroup = "all" | "systems" | "people" | "governance" | "reference" | "docs";

export const TYPE_GROUPS: ReadonlyArray<{ value: MemoryTypeGroup; label: string; types: readonly MemoryNoteType[] }> = [
  { value: "all", label: "All", types: MEMORY_NOTE_TYPES },
  { value: "systems", label: "Systems", types: ["system"] },
  { value: "people", label: "People", types: ["team", "stakeholder"] },
  { value: "governance", label: "Governance", types: ["decision", "convention", "kpi"] },
  { value: "reference", label: "Reference", types: ["glossary", "org"] },
  { value: "docs", label: "Docs & projects", types: ["document", "project"] },
];

// ---------------------------------------------------------------------------------------------
// CLI pass-through shapes (get / search / stale / index build)
// ---------------------------------------------------------------------------------------------

export type MemorySourceKind = "document" | "jira" | "confluence" | "code";

/** A claim source (CONTRACT §2.5). `ref` is the document slug, ticket key, page id or bitbucket path. */
export interface MemorySource {
  kind: MemorySourceKind;
  ref: string;
  /** Only on `document` sources: the `§<section>` the claim cites. */
  section?: string;
}

/**
 * Frontmatter keys beyond id/type/title/summary, exactly as `get` returns them in `card.props`.
 * Values are strings or arrays of strings only (CONTRACT §2.2); wikilink values keep their
 * `[[...]]` form. `status`, `project` and `updated` are duplicated here from the card.
 */
export interface MemoryNoteProps {
  origin?: string;
  sources?: string[];
  category?: string;
  owner?: string;
  aliases?: string[];
  tags?: string[];
  jira?: string[];
  related?: string[];
  depends_on?: string[];
  consumers?: string[];
  projects?: string[];
  systems?: string[];
  documents?: string[];
  /** Present on notes the seed wrote as stubs because the secret scan hit (value e.g. "secret"). */
  seed_blocked?: string;
  /** Document notes only. */
  doc_type?: string;
  path?: string;
  accepted_sha256?: string;
  signed_off_at?: string;
  run?: string;
  project?: string;
  [key: string]: string | string[] | undefined;
}

/** `get` card: identity fields plus the remaining frontmatter as `props`. */
export interface MemoryNoteCard {
  id: string;
  type: MemoryNoteType;
  title: string;
  summary: string;
  status: string | null;
  project: string | null;
  /** Vault-relative posix path, e.g. `systems/customer-service.md`. */
  path: string;
  /** ISO date `YYYY-MM-DD`. */
  updated: string;
  props: MemoryNoteProps;
}

/** One row of `get --claims`. `blockId` is the bare 6-hex id, without the `c-` prefix. */
export interface MemoryClaim {
  blockId: string;
  noteId: string;
  notePath: string;
  text: string;
  proposed: boolean;
  sources: MemorySource[];
  /** `document/<slug>` of the first document source, else null. */
  docId: string | null;
  section: string | null;
  project: string | null;
  textSha256?: string;
  /** True when the cited document's file drifted from its accepted sha. */
  stale: boolean;
}

/** A bullet under `## Retired claims`, parsed server-side from the note file (CONTRACT §2.4). */
export interface MemoryRetiredClaim {
  /** Bare 6-hex id, or null when the bullet lacks a trailing `^c-xxxxxx`. */
  blockId: string | null;
  text: string;
  proposed: boolean;
  sources: MemorySource[];
  /** The `(retired: <reason>)` reason; "" when the marker is missing. */
  retired: string;
}

/** `get --links`: resolved wikilink edges. `property` is null for body wikilinks (mentions). */
export interface MemoryNeighbor {
  id: string;
  property: string | null;
}

export interface MemoryNeighbors {
  out: MemoryNeighbor[];
  in: MemoryNeighbor[];
}

/** `stale` entry, enriched server-side with the document note's title. */
export interface MemoryStaleEntry {
  /** The document note id, e.g. `document/brd-x`. */
  document: string;
  /** Workspace-relative path of the signed-off file, e.g. `brd/x.md`. */
  path: string;
  acceptedSha256: string;
  currentSha256: string;
  /** How many claims cite this document. */
  claims: number;
  /** Enrichment: the document note's title (null when the note vanished between calls). */
  title: string | null;
}

/**
 * One `search` hit. Card hits carry `type`/`title`; claim hits carry `note` (the owning note id)
 * and their `id` is the block id WITH its `c-` prefix; section hits carry `path`/`heading`/`owner`.
 * The server additionally fills `title`/`type`/`note` for claim and note-section hits from its
 * snapshot, so every hit can render a destination.
 */
export interface MemorySearchHit {
  kind: "card" | "claim" | "section";
  id: string;
  score: number;
  why: string[];
  snippet: string;
  project: string | null;
  type?: MemoryNoteType | null;
  title?: string | null;
  /** Claim hits (and enriched note-section hits): the owning note's id. */
  note?: string | null;
  /** Section hits: owner path (vault- or workspace-relative) and heading path. */
  path?: string;
  heading?: string;
  owner?: "note" | "working";
}

export interface MemorySearchPayload {
  query: string;
  hits: MemorySearchHit[];
  warnings: string[];
}

/** `index build` output (CONTRACT §3 BuildStats). */
export interface MemoryBuildStats {
  changed: { notes: number; claims: number; sections: number; workingDocs: number; vectors: number };
  totals: { notes: number; claims: number; sections: number; documents: number; workingDocs: number; vectors: number };
  stale: Array<Omit<MemoryStaleEntry, "title">>;
  unresolvedLinks: Array<{ from: string; target: string }>;
  lint: Array<{ rule: string; path: string; line?: number; message: string }>;
  embeddings: "on" | "off" | "unavailable";
  warnings: string[];
}

/** The `{error, code, details, warnings}` JSON the CLI prints on any non-zero exit. */
export interface MemoryCliErrorPayload {
  error: string;
  code: number;
  details?: unknown;
  warnings?: string[];
}

// ---------------------------------------------------------------------------------------------
// Server-assembled payloads
// ---------------------------------------------------------------------------------------------

/** Trust signals derived per note from the snapshot. */
export interface MemoryNoteFlags {
  /** The seed wrote this note as a stub because the secret scan hit. */
  seedBlocked: boolean;
  /** At least one claim is `(proposed)`. */
  hasProposed: boolean;
  /** Document note whose signed-off file drifted from its accepted sha. */
  isStaleDoc: boolean;
}

/** One row of the overview table. */
export interface MemoryNoteListItem {
  card: MemoryNoteCard;
  claimCount: number;
  /** Distinct in+out edges of the note. */
  linkCount: number;
  flags: MemoryNoteFlags;
}

export interface MemoryStats {
  notes: number;
  claims: number;
  proposedClaims: number;
  staleDocs: number;
  /** Deduped typed + body edges (what the graph shows). */
  edges: number;
  byType: Record<MemoryNoteType, number>;
  byStatus: Record<string, number>;
  byOrigin: Record<string, number>;
  /** Only notes that declare a `category` are counted. */
  byCategory: Record<string, number>;
}

export interface MemoryOverviewPayload {
  stats: MemoryStats;
  notes: MemoryNoteListItem[];
  stale: MemoryStaleEntry[];
  generatedAt: number;
}

/** What a `[[target]]` in the prose resolved to (null when unresolved). */
export interface MemoryResolvedLink {
  id: string;
  title: string;
  type: MemoryNoteType;
  status: string | null;
}

/** A neighbor with enough of its card to render a connection row. */
export interface MemoryNeighborInfo extends MemoryNeighbor {
  title: string | null;
  type: MemoryNoteType | null;
  status: string | null;
}

export interface MemoryNoteDetailPayload {
  card: MemoryNoteCard;
  claims: MemoryClaim[];
  retired: MemoryRetiredClaim[];
  /**
   * The note body as markdown, minus the frontmatter, the leading `# title` line and the reserved
   * `Claims` / `Retired claims` sections (those ship as `claims` / `retired`).
   */
  prose: string;
  /**
   * Wikilink resolution for the prose, keyed by the target as written inside `[[...]]` with any
   * `|alias` and `#heading` / `#^block` suffix removed. Missing key or null value = unresolved.
   */
  resolvedLinks: Record<string, MemoryResolvedLink | null>;
  neighbors: { out: MemoryNeighborInfo[]; in: MemoryNeighborInfo[] };
  flags: MemoryNoteFlags;
  generatedAt: number;
}

export interface MemoryGraphNode {
  id: string;
  type: MemoryNoteType;
  title: string;
  status: string | null;
  linkCount: number;
  claimCount: number;
  flags: MemoryNoteFlags;
}

/** One deduped directed edge, taken from `links.out` only. `property` null = body mention. */
export interface MemoryGraphEdge {
  from: string;
  to: string;
  property: string | null;
}

export interface MemoryGraphPayload {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  generatedAt: number;
}

/** What `checkVault()` resolved (plan A1). All paths are absolute. */
export interface MemoryWorkspaceCheck {
  /** vaultExists && cliExists. */
  ok: boolean;
  workspace: string;
  vaultDir: string;
  cliPath: string;
  vaultExists: boolean;
  cliExists: boolean;
  indexExists: boolean;
}

export type MemoryIndexState = "ready" | "missing" | "building";

export interface MemoryStatusPayload {
  check: MemoryWorkspaceCheck;
  indexState: MemoryIndexState;
  /** From the fs walk; 0 when the vault is missing. */
  noteCount: number;
  generatedAt: number;
}

// ---------------------------------------------------------------------------------------------
// Note paths (CONTRACT §2.1, the CLI's idFor / pathFor)
// ---------------------------------------------------------------------------------------------

/** The vault folder inside the workspace. Git paths are workspace-relative: `memory/systems/x.md`. */
export const MEMORY_VAULT_PREFIX = "memory/";

const ORG_NOTE_PATH = "plexus.md";
const ORG_NOTE_ID = "org/plexus";
/** `<folder>/<slug>.md`, one level deep; anything else under the vault is not a note. */
const NOTE_PATH_RE = /^([a-z]+)\/([a-z0-9-]+)\.md$/;

/** Vault-relative path of a note id (`system/x` → `systems/x.md`, `org/plexus` → `plexus.md`); null for a malformed id. */
export function notePathForId(id: string): string | null {
  if (id === ORG_NOTE_ID) return ORG_NOTE_PATH;
  if (!isMemoryNoteId(id)) return null;
  const [type, slug] = id.split("/");
  const folder = NOTE_TYPES.find((t) => t.type === type)?.folder;
  return folder ? `${folder}/${slug}.md` : null;
}

/**
 * The note id a vault-relative path holds, or null when the file is not a note: `README.md`,
 * `_bases/`, `_templates/`, `.obsidian/`, `.index/`, `brd-memory.md` and any other root file,
 * nested folders, non-`.md` files and slugs outside `[a-z0-9-]+`.
 */
export function noteIdForPath(vaultRel: string): string | null {
  if (vaultRel === ORG_NOTE_PATH) return ORG_NOTE_ID;
  const m = NOTE_PATH_RE.exec(vaultRel);
  if (!m) return null;
  const type = NOTE_TYPES.find((t) => t.folder === m[1])?.type;
  return type ? `${type}/${m[2]}` : null;
}

/** `memory/systems/x.md` → `systems/x.md`; null for a path outside the vault folder. */
export function vaultRelativePath(workspaceRel: string): string | null {
  return workspaceRel.startsWith(MEMORY_VAULT_PREFIX) ? workspaceRel.slice(MEMORY_VAULT_PREFIX.length) : null;
}

// ---------------------------------------------------------------------------------------------
// Git state (shared by Health and Timeline)
// ---------------------------------------------------------------------------------------------

/** Why there is no history: git missing from PATH, the workspace is not in a repository, or git failed. */
export type MemoryGitUnavailableReason = "no-git" | "not-a-repo" | "failed";

/**
 * The workspace repository as payloads report it. History and health answer 200 with `ok: false`
 * when git is unavailable, so the UI shows an empty state instead of an error.
 */
export type MemoryGitState =
  | {
      ok: true;
      /** Full sha of HEAD; null on an unborn branch (no commits yet). */
      head: string | null;
      /** First 7 hex of `head`. */
      shortHead: string | null;
      /** The checked-out branch; null when HEAD is detached. */
      branch: string | null;
      /** A shallow clone: history stops at the graft, not at the first commit. */
      shallow: boolean;
    }
  | { ok: false; reason: MemoryGitUnavailableReason; message: string };

// ---------------------------------------------------------------------------------------------
// Health (plan §3): GET /api/memory/health[?refresh=1]
// ---------------------------------------------------------------------------------------------

export type MemoryHealthGroupId = "integrity" | "freshness" | "coverage" | "trust";

export type MemoryHealthCheckId =
  | "loads"
  | "lint"
  | "links"
  | "index"
  | "committed"
  | "stale-docs"
  | "recency"
  | "connected"
  | "owners"
  | "claims"
  | "sources"
  | "tags"
  | "seed-blocked"
  | "proposed"
  | "retired-deps";

/** "skipped": the check could not be evaluated (no snapshot, no git, lint failed) and is left out of the score. */
export type MemoryHealthStatus = "pass" | "warn" | "fail" | "skipped";

/** Excellent ≥ 90, Good ≥ 75, Fair ≥ 50, Poor < 50. */
export type MemoryHealthBand = "excellent" | "good" | "fair" | "poor";

/**
 * ready: every input was available. partial: some were not (index missing, git unavailable, lint
 * failed), so their checks are skipped. building: an index build is running; poll again.
 */
export type MemoryHealthState = "ready" | "partial" | "building";

/** One note (or vault file) a check lists. */
export interface MemoryHealthAffected {
  /** Note id; null for a vault file that is not a note (a lint finding on README.md). */
  id: string | null;
  title: string | null;
  /** Vault-relative path, when known. */
  path: string | null;
  /** Why it is listed, e.g. "no owner", "unresolved [[systems/x]]", "updated 2025-01-02". */
  detail: string | null;
}

/** What a check counted: `value` of `of`, plus the one-line summary its row shows. */
export interface MemoryHealthMeasure {
  value: number;
  /** The population, e.g. 42 notes; null for a bare count (lint findings, seed-blocked notes). */
  of: number | null;
  /** e.g. "32 of 42 notes have a connection". */
  summary: string;
}

export interface MemoryHealthCheck {
  id: MemoryHealthCheckId;
  group: MemoryHealthGroupId;
  status: MemoryHealthStatus;
  /** Points the check is worth (its catalogue weight). */
  weight: number;
  /** Share of the weight earned, 0..1; null when skipped. */
  score: number | null;
  measure: MemoryHealthMeasure;
  /** Up to 50 entries, worst first. */
  affected: MemoryHealthAffected[];
  /** How many there are in all (affected is capped). */
  affectedTotal: number;
  /** Extra context, e.g. "Embeddings are off" or why the check was skipped. */
  note?: string;
}

/** A group's points: Σ weight·score over its evaluated checks, out of Σ weight. */
export interface MemoryHealthGroup {
  id: MemoryHealthGroupId;
  earned: number;
  possible: number;
}

export interface MemoryHealthCounts {
  pass: number;
  warn: number;
  fail: number;
  skipped: number;
}

/** The newest note file on disk (mtime), with its title when the snapshot has it. */
export interface MemoryHealthLastChange {
  id: string;
  /** Vault-relative. */
  path: string;
  title: string | null;
  /** File mtime, ms since epoch. */
  at: number;
}

/** `git log -1 -- memory/`. */
export interface MemoryHealthLastCommit {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  /** Committer date, ISO 8601. */
  at: string;
}

export interface MemoryHealthPayload {
  state: MemoryHealthState;
  /** 0–100 after caps; null when nothing could be evaluated. */
  score: number | null;
  band: MemoryHealthBand | null;
  counts: MemoryHealthCounts;
  /** Always the four groups, in catalogue order. */
  groups: MemoryHealthGroup[];
  /** Catalogue order. */
  checks: MemoryHealthCheck[];
  vault: {
    notes: number;
    claims: number;
    edges: number;
    /** Note files that differ from HEAD (incl. untracked); null when git is unavailable. */
    uncommitted: number | null;
    lastChange: MemoryHealthLastChange | null;
    lastCommit: MemoryHealthLastCommit | null;
  };
  index: {
    state: MemoryIndexState;
    /** memory.sqlite mtime, ms since epoch; null when missing. */
    builtAt: number | null;
    /** From the last build this server saw; null when unknown. */
    embeddings: MemoryBuildStats["embeddings"] | null;
  };
  /** Null when lint could not run. `fatal` counts findings of the rules that abort an index build. */
  lint: { findings: number; fatal: number; checkedAt: number } | null;
  git: MemoryGitState;
  /** Inputs that failed; their checks are skipped. */
  errors: Array<{ source: "snapshot" | "lint" | "git" | "index"; message: string }>;
  checkedAt: number;
}

// ---------------------------------------------------------------------------------------------
// Timeline (plan §4): GET /api/memory/timeline, notes/:type/:slug/history, commits/:sha
// ---------------------------------------------------------------------------------------------

/** The sha that stands for the uncommitted working tree in events, history entries and commits/:sha. */
export const MEMORY_WORKING_SHA = "working";

/** The timeline filter (`?kind=`): every event, sign-off commits only, or everything else. */
export const MEMORY_TIMELINE_KINDS = ["all", "signoff", "edit"] as const;
export type MemoryTimelineKind = (typeof MEMORY_TIMELINE_KINDS)[number];

export function isMemoryTimelineKind(value: string): value is MemoryTimelineKind {
  return (MEMORY_TIMELINE_KINDS as readonly string[]).includes(value);
}

/** signoff: a `memory: sign-off of <slug>` commit; commit: any other; uncommitted: the working tree. */
export type MemoryTimelineEventKind = "signoff" | "commit" | "uncommitted";

/** A file's git status letter in a commit (`--raw`); untracked working-tree files are "A" with `untracked`. */
export type MemoryChangeStatus = "A" | "M" | "D" | "R" | "C" | "T";

/** One vault file a commit (or the working tree) changed. */
export interface MemoryFileChange {
  status: MemoryChangeStatus;
  /** Workspace-relative posix path after the change, e.g. `memory/systems/x.md`. */
  path: string;
  /** The path before a rename or copy; null otherwise. */
  oldPath: string | null;
  /** noteIdForPath of `path`; null for vault files that are not notes. */
  noteId: string | null;
  /** noteIdForPath of `oldPath`. */
  oldNoteId: string | null;
  /** Current title from the snapshot; null for removed notes, other files, or when unknown. */
  title: string | null;
  /** `--numstat`; null for binary files. */
  additions: number | null;
  deletions: number | null;
  /** Working tree only: a file git does not track yet. */
  untracked?: boolean;
}

export type MemoryClaimChangeKind = "added" | "retired" | "removed" | "edited" | "promoted";

/** What happened to one claim (`^c-<id>`) in a commit. */
export interface MemoryClaimChange {
  kind: MemoryClaimChangeKind;
  /** Bare 6-hex block id, without `c-`. */
  blockId: string;
  noteId: string;
  /** The claim text after the change; before it for "removed". */
  text: string;
  /** "edited": the text before. */
  previousText?: string;
  /** "retired": the `(retired: …)` reason. */
  reason?: string;
  /** "retired" with reason `superseded by ^c-<id>`: that bare id; null otherwise. */
  supersededBy?: string | null;
}

export type MemoryClaimCounts = Record<MemoryClaimChangeKind, number>;

/** `claimDeltas(diff)`: every claim change in a diff (note files only) and their counts. */
export interface MemoryClaimDelta {
  counts: MemoryClaimCounts;
  changes: MemoryClaimChange[];
}

/**
 * Whether claim changes were counted: yes; truncated (the diff hit the 4 MB cap, counts are a
 * lower bound); too-large (over 200k changed lines, not analysed); failed (git error).
 */
export type MemoryClaimsAnalysed = "yes" | "truncated" | "too-large" | "failed";

/** A changed file plus the claim changes inside it (the diff sheet's file list). */
export interface MemoryCommitFile extends MemoryFileChange {
  claims: MemoryClaimChange[];
}

/** Per-event counts for the change chips. */
export interface MemoryTimelineTotals {
  notesAdded: number;
  notesChanged: number;
  notesRemoved: number;
  notesRenamed: number;
  /** Vault files that are not notes (README, templates, bases, Obsidian settings). */
  otherFiles: number;
  linesAdded: number;
  linesRemoved: number;
  claims: MemoryClaimCounts;
}

export interface MemoryTimelineEvent {
  kind: MemoryTimelineEventKind;
  /** Full commit sha; MEMORY_WORKING_SHA for the uncommitted entry. */
  sha: string;
  shortSha: string;
  parents: string[];
  /** Commit subject; a generated line for the uncommitted entry. */
  subject: string;
  /** Null for the uncommitted entry. */
  author: { name: string; email: string } | null;
  /** ISO 8601. For the uncommitted entry, the newest mtime among its files. */
  authoredAt: string;
  committedAt: string;
  /** Sign-offs: the `<slug>` of `memory: sign-off of <slug>`. */
  project: string | null;
  /** Adds ≥ 10 notes and ≥ 80% of its note changes are additions (a seed or an import). */
  bulk: boolean;
  files: MemoryFileChange[];
  totals: MemoryTimelineTotals;
  claimsAnalysed: MemoryClaimsAnalysed;
}

/** Page 1 only: the strip above the timeline and the weekly chart. */
export interface MemoryTimelineSummary {
  commits: number;
  signoffs: number;
  /** Distinct notes any commit touched. */
  notesTouched: number;
  /** ISO 8601 of the newest commit (or uncommitted change); null for an empty history. */
  lastChangeAt: string | null;
  /** Oldest first; `week` is the Monday, `YYYY-MM-DD`. */
  weeks: Array<{ week: string; commits: number; signoffs: number }>;
}

export interface MemoryTimelinePayload {
  git: MemoryGitState;
  /** Page 1 only: the uncommitted vault changes, or null when the vault is clean. */
  working: MemoryTimelineEvent | null;
  /** Newest first. */
  events: MemoryTimelineEvent[];
  /** Opaque `<pinnedHead>.<offset>` for `?before=`; null at the start of history. */
  nextCursor: string | null;
  /** Page 1 only. */
  summary?: MemoryTimelineSummary;
  generatedAt: number;
}

/** One commit (or the working tree) that touched a note. */
export interface MemoryNoteHistoryEntry {
  kind: MemoryTimelineEventKind;
  sha: string;
  shortSha: string;
  /** What happened to this note: A created, M edited, R renamed, D removed. */
  status: MemoryChangeStatus;
  /** Workspace-relative path at that commit. */
  path: string;
  oldPath: string | null;
  subject: string;
  author: { name: string; email: string } | null;
  committedAt: string;
  project: string | null;
  additions: number | null;
  deletions: number | null;
  /** Null when the commit was not analysed (MemoryClaimsAnalysed other than yes/truncated). */
  claims: MemoryClaimCounts | null;
  claimChanges: MemoryClaimChange[];
}

export interface MemoryNoteHistoryPayload {
  id: string;
  /** Vault-relative path today (notePathForId). */
  path: string | null;
  git: MemoryGitState;
  /** Newest first; the uncommitted entry on top when the note has uncommitted changes. */
  entries: MemoryNoteHistoryEntry[];
  /** More entries exist beyond `limit`. */
  hasMore: boolean;
  generatedAt: number;
}

export interface MemoryCommitDiffPayload {
  git: MemoryGitState;
  /** Null when git is unavailable. */
  commit: MemoryTimelineEvent | null;
  files: MemoryCommitFile[];
  /** The file the diff is limited to (workspace-relative), or null for every vault file of the commit. */
  path: string | null;
  /** Unified git diff text (TextDiff's `diffText`). */
  diff: string;
  /** The diff hit its 1 MB cap and was cut at a line boundary. */
  truncated: boolean;
  generatedAt: number;
}
