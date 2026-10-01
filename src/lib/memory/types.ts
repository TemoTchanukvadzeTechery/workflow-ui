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
