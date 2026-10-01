import "server-only";
/**
 * Read-only view over the memory vault (plan A1). A snapshot (cards + claims + links + stats +
 * graph) is assembled from bulk CLI `get` calls and cached on globalThis, keyed by a cheap fs
 * fingerprint of the note files, so Obsidian edits are picked up without watching. Note bodies are
 * read straight from the vault files (no spawn) for the detail page.
 */
import fs from "node:fs";
import path from "node:path";
import {
  NOTE_TYPES,
  type MemoryBuildStats,
  type MemoryClaim,
  type MemoryGraphEdge,
  type MemoryGraphPayload,
  type MemoryNeighborInfo,
  type MemoryNeighbors,
  type MemoryNoteCard,
  type MemoryNoteDetailPayload,
  type MemoryNoteFlags,
  type MemoryNoteListItem,
  type MemoryNoteType,
  type MemoryOverviewPayload,
  type MemoryResolvedLink,
  type MemoryRetiredClaim,
  type MemorySearchHit,
  type MemorySearchPayload,
  type MemoryStaleEntry,
  type MemoryStats,
  type MemoryStatusPayload,
} from "@/lib/memory/types";
import { parseRetiredBullet } from "./claim-grammar";
import { assertMemoryNoteId, isMemoryCliError, memoryIndexBuilding, runMemory, runMemoryBuild } from "./cli";
import { checkVault, memoryPaths } from "./config";

export { memoryIndexBuilding };

const WALK_TTL_MS = 5_000;
/** Ids per `get` spawn: one argv comfortably holds 150 ids and the JSON stays well under maxBuffer. */
const GET_CHUNK = 150;
const SEARCH_LRU = 30;
const SEARCH_LIMIT_MAX = 100;

const CLAIMS_HEADING = "Claims";
const RETIRED_HEADING = "Retired claims";

// ---------------------------------------------------------------------------------------------
// State (HMR-safe)
// ---------------------------------------------------------------------------------------------

interface WalkFile {
  id: string;
  /** Vault-relative posix path. */
  path: string;
  mtimeMs: number;
}

interface Fingerprint {
  /** Changes whenever a note file appears, vanishes or is touched. */
  key: string;
  files: WalkFile[];
  count: number;
  maxMtimeMs: number;
}

export interface SnapshotNote {
  card: MemoryNoteCard;
  claims: MemoryClaim[];
  links: MemoryNeighbors;
  flags: MemoryNoteFlags;
  claimCount: number;
  linkCount: number;
}

export interface MemorySnapshot {
  key: string;
  generatedAt: number;
  byId: Map<string, SnapshotNote>;
  byPath: Map<string, SnapshotNote>;
  list: MemoryNoteListItem[];
  stats: MemoryStats;
  graph: MemoryGraphPayload;
  stale: MemoryStaleEntry[];
  /** Wikilink resolution, CONTRACT §2.6 order: path w/o .md → id → unique basename → title → alias. */
  resolve(target: string): MemoryNoteCard | null;
}

/**
 * The last `index build` this server ran (implicitly when the index was older than the notes, or
 * from POST index/build). Health reuses its lint findings while `key` still matches the walk.
 */
export interface MemoryBuildRecord {
  /** The vault fingerprint taken just before the build. */
  key: string;
  /** When the build finished (or failed), ms since epoch. */
  at: number;
  /** Null when the build failed. */
  stats: MemoryBuildStats | null;
  /** A failed build: the CLI's error. A fatal lint finding aborts with code 2 and `details.findings`. */
  failure: { message: string; code: number; details: unknown } | null;
}

interface ServiceState {
  walk?: { at: number; fp: Fingerprint };
  snapshot?: { key: string; promise: Promise<MemorySnapshot> };
  search: Map<string, Promise<MemorySearchPayload>>;
  searchKey?: string;
  build?: MemoryBuildRecord;
}

const state: ServiceState = ((globalThis as { __memoryService?: ServiceState }).__memoryService ??= { search: new Map() });

// ---------------------------------------------------------------------------------------------
// Fingerprint: fs walk of the note files (cached 5 s)
// ---------------------------------------------------------------------------------------------

function walkVault(): Fingerprint {
  const { vaultDir } = memoryPaths();
  const files: WalkFile[] = [];
  for (const { type, folder } of NOTE_TYPES) {
    if (folder === "") {
      // At the vault root only plexus.md is a note (CONTRACT §2.1).
      const p = path.join(vaultDir, "plexus.md");
      try {
        const st = fs.statSync(p);
        if (st.isFile()) files.push({ id: "org/plexus", path: "plexus.md", mtimeMs: st.mtimeMs });
      } catch {
        // no org note
      }
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(vaultDir, folder), { withFileTypes: true });
    } catch {
      continue; // folder absent: no notes of this type
    }
    for (const entry of entries) {
      const name = entry.name;
      if (!name.endsWith(".md") || name.startsWith("_") || name.startsWith(".")) continue;
      if (entry.isSymbolicLink() || !entry.isFile()) continue; // the loader never follows symlinks
      const rel = `${folder}/${name}`;
      try {
        const st = fs.statSync(path.join(vaultDir, folder, name));
        files.push({ id: `${type}/${name.slice(0, -3)}`, path: rel, mtimeMs: st.mtimeMs });
      } catch {
        // raced away between readdir and stat
      }
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const maxMtimeMs = files.reduce((max, f) => Math.max(max, f.mtimeMs), 0);
  const key = `${files.length}:${Math.round(maxMtimeMs)}:${files.map((f) => `${f.path}@${Math.round(f.mtimeMs)}`).join("|")}`;
  return { key, files, count: files.length, maxMtimeMs };
}

/**
 * Forget the cached walk so the next read re-stats the vault. The vault watcher calls this when
 * a note file changes; the snapshot and search caches follow because they key on the walk.
 */
export function invalidateMemoryWalk(): void {
  state.walk = undefined;
}

function fingerprint(): Fingerprint {
  const now = Date.now();
  if (state.walk && now - state.walk.at < WALK_TTL_MS) return state.walk.fp;
  const fp = walkVault();
  state.walk = { at: now, fp };
  return fp;
}

export interface MemoryVaultWalk {
  /** The fingerprint the snapshot and search caches key on; changes with any note file. */
  key: string;
  count: number;
  /** The note file with the newest mtime; null for an empty vault. */
  newest: { id: string; path: string; mtimeMs: number } | null;
}

/** The cached fs walk of the note files (no spawn; at most one walk per 5 s). */
export function vaultWalk(): MemoryVaultWalk {
  const fp = fingerprint();
  let newest: WalkFile | null = null;
  for (const f of fp.files) if (!newest || f.mtimeMs > newest.mtimeMs) newest = f;
  return { key: fp.key, count: fp.count, newest: newest ? { id: newest.id, path: newest.path, mtimeMs: newest.mtimeMs } : null };
}

/** The last index build this server ran, successful or not; undefined until one runs. */
export function lastMemoryBuild(): MemoryBuildRecord | undefined {
  return state.build;
}

/** Run `index build` and remember its stats (or its failure) against the fingerprint `key`. */
async function buildAndRecord(key: string): Promise<MemoryBuildStats> {
  try {
    const stats = await runMemoryBuild();
    state.build = { key, at: Date.now(), stats, failure: null };
    return stats;
  } catch (err) {
    const failure = isMemoryCliError(err)
      ? { message: err.message, code: err.code, details: err.details }
      : { message: err instanceof Error ? err.message : String(err), code: 5, details: undefined };
    state.build = { key, at: Date.now(), stats: null, failure };
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------------------------

interface GetResponse {
  notes: Array<{ card: MemoryNoteCard; claims?: MemoryClaim[]; links?: MemoryNeighbors }>;
  missing: string[];
  warnings: string[];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Rebuild the index first when memory.sqlite is missing or older than the newest note (Obsidian edits). */
async function ensureIndexFresh(fp: Fingerprint): Promise<void> {
  const { indexFile } = memoryPaths();
  let indexMtime = -1;
  try {
    indexMtime = fs.statSync(indexFile).mtimeMs;
  } catch {
    // missing: build below
  }
  if (indexMtime < fp.maxMtimeMs) await buildAndRecord(fp.key);
}

function emptyStats(): MemoryStats {
  const byType = Object.fromEntries(NOTE_TYPES.map((t) => [t.type, 0])) as Record<MemoryNoteType, number>;
  return { notes: 0, claims: 0, proposedClaims: 0, staleDocs: 0, edges: 0, byType, byStatus: {}, byOrigin: {}, byCategory: {} };
}

function buildResolver(cards: MemoryNoteCard[]): (target: string) => MemoryNoteCard | null {
  const byPathNoMd = new Map<string, MemoryNoteCard>();
  const byId = new Map<string, MemoryNoteCard>();
  const byBasename = new Map<string, MemoryNoteCard | null>(); // null = ambiguous
  const byTitle = new Map<string, MemoryNoteCard>();
  const byAlias = new Map<string, MemoryNoteCard>();
  for (const card of cards) {
    byPathNoMd.set(card.path.replace(/\.md$/, ""), card);
    byId.set(card.id, card);
    const base = card.path.replace(/\.md$/, "").split("/").pop()!.toLowerCase();
    byBasename.set(base, byBasename.has(base) ? null : card);
    const title = card.title.toLowerCase();
    if (!byTitle.has(title)) byTitle.set(title, card);
    for (const alias of card.props.aliases ?? []) {
      const a = alias.toLowerCase();
      if (!byAlias.has(a)) byAlias.set(a, card);
    }
  }
  return (target: string) => {
    const wanted = target.trim();
    if (wanted === "") return null;
    const direct = byPathNoMd.get(wanted) ?? byId.get(wanted);
    if (direct) return direct;
    const lower = wanted.toLowerCase();
    if (!wanted.includes("/")) {
      const base = byBasename.get(lower);
      if (base) return base;
    }
    return byTitle.get(lower) ?? byAlias.get(lower) ?? null;
  };
}

async function buildSnapshot(fp: Fingerprint): Promise<MemorySnapshot> {
  await ensureIndexFresh(fp);

  const entries: Array<{ card: MemoryNoteCard; claims: MemoryClaim[]; links: MemoryNeighbors }> = [];
  for (const ids of chunk(fp.files.map((f) => f.id), GET_CHUNK)) {
    const res = await runMemory<GetResponse>(["get", ...ids, "--claims", "--links"]);
    for (const note of res.notes) entries.push({ card: note.card, claims: note.claims ?? [], links: note.links ?? { out: [], in: [] } });
    if (res.missing.length > 0) console.warn(`[memory] index is missing notes the walk found: ${res.missing.join(", ")}`);
  }
  const rawStale = await runMemory<{ stale: Array<Omit<MemoryStaleEntry, "title">> }>(["stale"]);

  const staleDocs = new Set(rawStale.stale.map((s) => s.document));
  const stats = emptyStats();
  const byId = new Map<string, SnapshotNote>();
  const byPath = new Map<string, SnapshotNote>();
  const list: MemoryNoteListItem[] = [];
  const edgeKeys = new Set<string>();
  const edges: MemoryGraphEdge[] = [];

  for (const { card, claims, links } of entries) {
    const linkCount = new Set([
      ...links.out.map((l) => `>${l.id}\u0000${l.property ?? ""}`),
      ...links.in.map((l) => `<${l.id}\u0000${l.property ?? ""}`),
    ]).size;
    const flags: MemoryNoteFlags = {
      seedBlocked: card.props.seed_blocked !== undefined,
      hasProposed: claims.some((c) => c.proposed),
      isStaleDoc: staleDocs.has(card.id),
    };
    const note: SnapshotNote = { card, claims, links, flags, claimCount: claims.length, linkCount };
    byId.set(card.id, note);
    byPath.set(card.path, note);
    list.push({ card, claimCount: claims.length, linkCount, flags });

    stats.notes += 1;
    stats.claims += claims.length;
    stats.proposedClaims += claims.filter((c) => c.proposed).length;
    stats.byType[card.type] = (stats.byType[card.type] ?? 0) + 1;
    const status = card.status ?? "none";
    stats.byStatus[status] = (stats.byStatus[status] ?? 0) + 1;
    const origin = typeof card.props.origin === "string" ? card.props.origin : "unknown";
    stats.byOrigin[origin] = (stats.byOrigin[origin] ?? 0) + 1;
    if (typeof card.props.category === "string") stats.byCategory[card.props.category] = (stats.byCategory[card.props.category] ?? 0) + 1;

    for (const out of links.out) {
      const key = `${card.id}\u0000${out.id}\u0000${out.property ?? ""}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ from: card.id, to: out.id, property: out.property });
    }
  }
  stats.staleDocs = rawStale.stale.length;
  stats.edges = edges.length;

  const generatedAt = Date.now();
  const stale: MemoryStaleEntry[] = rawStale.stale.map((s) => ({ ...s, title: byId.get(s.document)?.card.title ?? null }));
  const graph: MemoryGraphPayload = {
    nodes: list.map(({ card, linkCount, claimCount, flags }) => ({ id: card.id, type: card.type, title: card.title, status: card.status, linkCount, claimCount, flags })),
    edges,
    generatedAt,
  };
  const resolveCard = buildResolver(list.map((n) => n.card));
  return { key: fp.key, generatedAt, byId, byPath, list, stats, graph, stale, resolve: resolveCard };
}

export function getSnapshot(): Promise<MemorySnapshot> {
  const fp = fingerprint();
  if (state.searchKey !== fp.key) {
    state.search.clear();
    state.searchKey = fp.key;
  }
  if (state.snapshot?.key === fp.key) return state.snapshot.promise;
  const promise = buildSnapshot(fp);
  state.snapshot = { key: fp.key, promise };
  promise.catch(() => {
    if (state.snapshot?.promise === promise) state.snapshot = undefined;
  });
  return promise;
}

// ---------------------------------------------------------------------------------------------
// Overview / graph / stale
// ---------------------------------------------------------------------------------------------

export async function getOverview(): Promise<MemoryOverviewPayload> {
  const snap = await getSnapshot();
  return { stats: snap.stats, notes: snap.list, stale: snap.stale, generatedAt: snap.generatedAt };
}

export async function getGraph(): Promise<MemoryGraphPayload> {
  return (await getSnapshot()).graph;
}

export async function getStale(): Promise<MemoryStaleEntry[]> {
  return (await getSnapshot()).stale;
}

// ---------------------------------------------------------------------------------------------
// Note detail: snapshot entry + the body read from the vault file (no spawn)
// ---------------------------------------------------------------------------------------------

/** The body after the frontmatter block (CONTRACT §2.2), with an optional leading `# title` dropped. */
function stripFrontmatter(text: string): string {
  const lines = text.split(/\r?\n/);
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end > 0) start = end + 1;
  }
  while (start < lines.length && lines[start].trim() === "") start += 1;
  if (lines[start]?.startsWith("# ")) start += 1;
  return lines.slice(start).join("\n");
}

/** Split the body into prose (H2 sections that are not reserved) and the retired-claim bullets. */
function splitBody(body: string): { prose: string; retired: MemoryRetiredClaim[] } {
  const proseLines: string[] = [];
  const retired: MemoryRetiredClaim[] = [];
  let section = ""; // the current H2 heading; "" = preamble
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("## ")) section = line.slice(3).trim();
    const reserved = section === CLAIMS_HEADING || section === RETIRED_HEADING;
    if (!reserved) {
      proseLines.push(line);
      continue;
    }
    if (section !== RETIRED_HEADING) continue;
    const bullet = parseRetiredBullet(line);
    if (bullet) retired.push(bullet);
  }
  return { prose: proseLines.join("\n").trim(), retired };
}

const WIKILINK_RE = /\[\[([^[\]]+)\]\]/g;

/** Resolve every `[[target]]` in the prose, keyed by the target without `|alias` / `#…` suffixes. */
function resolveWikilinks(prose: string, snap: MemorySnapshot): Record<string, MemoryResolvedLink | null> {
  const out: Record<string, MemoryResolvedLink | null> = {};
  for (const match of prose.matchAll(WIKILINK_RE)) {
    const target = match[1].split("|")[0].split("#")[0].trim();
    if (target === "" || target in out) continue;
    const card = snap.resolve(target);
    out[target] = card ? { id: card.id, title: card.title, type: card.type, status: card.status } : null;
  }
  return out;
}

function neighborInfo(neighbors: MemoryNeighbors, snap: MemorySnapshot): { out: MemoryNeighborInfo[]; in: MemoryNeighborInfo[] } {
  const info = (n: { id: string; property: string | null }): MemoryNeighborInfo => {
    const card = snap.byId.get(n.id)?.card;
    return { ...n, title: card?.title ?? null, type: card?.type ?? null, status: card?.status ?? null };
  };
  return { out: neighbors.out.map(info), in: neighbors.in.map(info) };
}

/** Everything the detail page needs, or null when the id is not in the vault. */
export async function noteDetail(id: string): Promise<MemoryNoteDetailPayload | null> {
  assertMemoryNoteId(id);
  const snap = await getSnapshot();
  const entry = snap.byId.get(id);
  if (!entry) return null;
  const { vaultDir } = memoryPaths();
  const abs = path.resolve(vaultDir, entry.card.path);
  if (!abs.startsWith(vaultDir + path.sep)) throw new Error(`note path escapes the vault: ${entry.card.path}`);
  const text = fs.readFileSync(abs, "utf8");
  const { prose, retired } = splitBody(stripFrontmatter(text));
  return {
    card: entry.card,
    claims: entry.claims,
    retired,
    prose,
    resolvedLinks: resolveWikilinks(prose, snap),
    neighbors: neighborInfo(entry.links, snap),
    flags: entry.flags,
    generatedAt: snap.generatedAt,
  };
}

// ---------------------------------------------------------------------------------------------
// Search: CLI pass-through with a small LRU, cleared whenever the vault fingerprint changes
// ---------------------------------------------------------------------------------------------

export interface MemorySearchOptions {
  types?: string[];
  deep?: boolean;
  limit?: number;
}

/** The CLI's arg parser treats `--tokens` as flags, so free text must not start tokens with `-`. */
function sanitizeQuery(q: string): string {
  return q
    .split(/\s+/)
    .map((w) => w.replace(/^-+/, ""))
    .filter((w) => w !== "")
    .join(" ")
    .slice(0, 500);
}

async function runSearch(query: string, opts: MemorySearchOptions): Promise<MemorySearchPayload> {
  const args = ["search", query];
  const types = (opts.types ?? []).filter((t) => /^[a-z]+$/.test(t));
  if (types.length > 0) args.push("--type", types.join(","));
  if (opts.deep) args.push("--deep");
  if (opts.limit !== undefined) args.push("--limit", String(Math.min(Math.max(1, Math.floor(opts.limit)), SEARCH_LIMIT_MAX)));
  const payload = await runMemory<MemorySearchPayload>(args);
  const snap = await getSnapshot();
  const hits = payload.hits.map((hit): MemorySearchHit => {
    if (hit.kind === "claim" && hit.note) {
      const card = snap.byId.get(hit.note)?.card;
      return { ...hit, title: card?.title ?? hit.title ?? null, type: card?.type ?? hit.type ?? null };
    }
    if (hit.kind === "section" && hit.owner === "note" && hit.path) {
      const card = snap.byPath.get(hit.path)?.card;
      if (card) return { ...hit, note: card.id, title: card.title, type: card.type };
    }
    return hit;
  });
  return { ...payload, hits };
}

export function searchMemory(q: string, opts: MemorySearchOptions = {}): Promise<MemorySearchPayload> {
  const query = sanitizeQuery(q);
  if (query === "") return Promise.resolve({ query: q, hits: [], warnings: [] });
  const fp = fingerprint();
  if (state.searchKey !== fp.key) {
    state.search.clear();
    state.searchKey = fp.key;
  }
  const key = JSON.stringify([query, [...(opts.types ?? [])].sort(), opts.deep ?? false, opts.limit ?? 0]);
  const cached = state.search.get(key);
  if (cached) {
    state.search.delete(key); // LRU bump: Map iteration order is insertion order
    state.search.set(key, cached);
    return cached;
  }
  const promise = runSearch(query, opts);
  state.search.set(key, promise);
  promise.catch(() => state.search.delete(key));
  while (state.search.size > SEARCH_LRU) {
    const oldest = state.search.keys().next().value;
    if (oldest === undefined) break;
    state.search.delete(oldest);
  }
  return promise;
}

// ---------------------------------------------------------------------------------------------
// Status and manual rebuild
// ---------------------------------------------------------------------------------------------

export function getMemoryStatus(): MemoryStatusPayload {
  const check = checkVault();
  let noteCount = 0;
  if (check.vaultExists) {
    try {
      noteCount = fingerprint().count;
    } catch {
      // unreadable vault: report 0
    }
  }
  const indexState = memoryIndexBuilding() ? "building" : check.indexExists ? "ready" : "missing";
  return { check, indexState, noteCount, generatedAt: Date.now() };
}

/** POST index/build: force a rebuild and drop every cache so the next read reflects it. */
export async function rebuildMemoryIndex(): Promise<MemoryBuildStats> {
  const stats = await buildAndRecord(walkVault().key);
  state.snapshot = undefined;
  state.walk = undefined;
  state.search.clear();
  return stats;
}
