import "server-only";
/**
 * The vault's git history (plan §4) behind GET /api/memory/timeline, notes/:type/:slug/history
 * and commits/:sha. Read-only, through runGit (git.ts):
 *
 * - vaultTimeline: one `git log --first-parent` page of commits that touch `memory/`, walked from
 *   a pinned HEAD so paging stays stable while commits land (the cursor is `<head>.<offset>`).
 *   Every commit on the page gets a claim analysis (`git show -U0 -G'\^c-…'` → claim-diff.ts).
 *   Page 1 adds the uncommitted working tree and a summary (counts, weekly buckets).
 * - noteHistory: `git log --follow` of one note joined with those analyses, the working change on top.
 * - commitDiff: one commit's (or the working tree's) files, claim changes and unified diff. Only
 *   HEAD and its ancestors qualify: refs/weft/snapshots/* commits are not in the vault's history.
 *
 * Diff-producing commands pass --relative, so their paths are workspace-relative (`memory/…`) even
 * when the workspace sits in a subfolder of the repository; porcelain status is repository-relative
 * and goes through stripPrefix. Caches live on globalThis: commit analyses and records are
 * immutable by sha; pages, follow logs, the summary and the working tree are dropped by the git
 * watcher's change hook (and the working tree also keys on the vault walk and .git/index).
 * Git missing or no repository → 200 payloads with `git.ok: false`; bad input → MemoryRequestError.
 */
import fs from "node:fs";
import path from "node:path";
import { plural } from "@/lib/format";
import {
  MEMORY_VAULT_PREFIX,
  MEMORY_WORKING_SHA,
  noteIdForPath,
  notePathForId,
  vaultRelativePath,
  type MemoryChangeStatus,
  type MemoryClaimChange,
  type MemoryClaimCounts,
  type MemoryClaimsAnalysed,
  type MemoryCommitDiffPayload,
  type MemoryCommitFile,
  type MemoryFileChange,
  type MemoryNoteHistoryEntry,
  type MemoryNoteHistoryPayload,
  type MemoryTimelineEvent,
  type MemoryTimelineKind,
  type MemoryTimelinePayload,
  type MemoryTimelineSummary,
  type MemoryTimelineTotals,
} from "@/lib/memory/types";
import { claimChangesByFile, countClaimChanges, type FileClaimChanges } from "./claim-diff";
import { checkVault, memoryPaths } from "./config";
import { MemoryRequestError } from "./errors";
import { gitState, isAncestor, isMemoryGitError, memoryGitGeneration, onMemoryGitChange, publicGitState, runGit, stripPrefix, type GitRepoState } from "./git";
import { getSnapshot, memoryIndexBuilding, vaultWalk } from "./service";

const DEFAULT_TIMELINE_LIMIT = 20;
const TIMELINE_LIMIT_MAX = 50;
const DEFAULT_HISTORY_LIMIT = 50;
const HISTORY_LIMIT_MAX = 200;

/** Files an event lists, notes first; the totals still count every file. */
const EVENT_FILES_MAX = 500;
/** A claim analysis reads at most this much `-U0` patch; past it the counts are a lower bound. */
const CLAIM_DIFF_MAX = 4 * 1024 * 1024;
/** Note lines changed (added + removed) past which a commit's claims are not analysed. */
const TOO_LARGE_LINES = 200_000;
/** The diff the sheet shows is cut at this size. */
const DIFF_MAX = 1024 * 1024;
/** Without `?path=`, a commit's whole diff is served only up to this many changed lines. */
const ALL_FILES_MAX_LINES = 4_000;
/** Untracked files are read from disk up to this size. */
const DISK_READ_MAX = 1024 * 1024;
/** How long the working-tree state is reused when nothing it keys on changed (non-note files are not in the walk). */
const WORKING_TTL_MS = 2_000;
/** How long a payload waits for the note snapshot's titles before going without them. */
const TITLE_WAIT_MS = 1_500;
const WEEKS_MAX = 52;

const ANALYSES_MAX = 300;
const RECORDS_MAX = 300;
const PAGES_MAX = 20;
const FOLLOWS_MAX = 50;

const SIGNOFF_RE = /^memory: sign-off of ([a-z0-9][a-z0-9-]*)$/;
const SHA_RE = /^[0-9a-f]{7,64}$/;
const CURSOR_RE = /^([0-9a-f]{40}|[0-9a-f]{64})\.(\d{1,9})$/;
const PATH_MAX = 1024;
const DAY_MS = 86_400_000;

/** %H %h %P %an %ae %aI %cI %s, unit-separated, each commit opened by a record separator. */
const LOG_FORMAT = "--format=%x1e%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cI%x1f%s";
/**
 * Every log/show/diff call: workspace-relative paths, the standard a/ b/ prefixes (whatever
 * diff.mnemonicPrefix or diff.noprefix say), no external diff or textconv drivers.
 */
const DIFF_ARGS = ["--relative", "--src-prefix=a/", "--dst-prefix=b/", "--no-ext-diff", "--no-textconv", "--no-color"];
/** Keeps only the files whose patch adds or removes a `^c-<6 hex>` claim line (git -G is an ERE). */
const CLAIM_PICKAXE = "-G\\^c-[0-9a-f]{6}";

const literal = (p: string) => `:(literal)${p}`;

// ---------------------------------------------------------------------------------------------
// State (HMR-safe)
// ---------------------------------------------------------------------------------------------

interface RawFile {
  status: MemoryChangeStatus;
  /** Workspace-relative. */
  path: string;
  oldPath: string | null;
  additions: number | null;
  deletions: number | null;
}

interface RawCommit {
  sha: string;
  shortSha: string;
  parents: string[];
  author: { name: string; email: string };
  authoredAt: string;
  committedAt: string;
  subject: string;
  files: RawFile[];
}

interface CommitAnalysis {
  state: MemoryClaimsAnalysed;
  files: FileClaimChanges[];
}

interface CommitPage {
  commits: RawCommit[];
  more: boolean;
  /** The offset of the page after this one. */
  nextOffset: number;
}

interface SummaryBase {
  commits: number;
  signoffs: number;
  notesTouched: number;
  lastCommitAt: string | null;
  weeks: MemoryTimelineSummary["weeks"];
}

interface WorkingFile extends RawFile {
  untracked: boolean;
  /** No HEAD to diff against or untracked: the diff and line counts come from the file on disk. */
  fromDisk: boolean;
  /** Null for a deleted file. */
  mtimeMs: number | null;
}

interface WorkingState {
  head: string | null;
  files: WorkingFile[];
  analysis: CommitAnalysis;
  /** Newest mtime among the files that still exist. */
  at: number;
}

interface HistoryState {
  /** The workspace the caches belong to; a different one starts over. */
  workspace?: string;
  analyses: Map<string, Promise<CommitAnalysis>>;
  /** One note of one commit (note history before the commit itself was analysed). */
  fileAnalyses: Map<string, Promise<CommitAnalysis>>;
  records: Map<string, Promise<RawCommit | null>>;
  pages: Map<string, Promise<CommitPage>>;
  follows: Map<string, Promise<CommitPage>>;
  summary?: { head: string; promise: Promise<SummaryBase> };
  working?: { key: string; at: number; promise: Promise<WorkingState | null> };
}

const h: HistoryState = ((globalThis as { __memoryHistory?: HistoryState }).__memoryHistory ??= {
  analyses: new Map(),
  fileAnalyses: new Map(),
  records: new Map(),
  pages: new Map(),
  follows: new Map(),
});

/** What a commit, checkout or vault edit can change; analyses and records are immutable by sha. */
function clearHistoryCaches(): void {
  h.pages.clear();
  h.follows.clear();
  h.summary = undefined;
  h.working = undefined;
}

// Re-registering under the same key replaces the old callback, so HMR never stacks them.
onMemoryGitChange("history", clearHistoryCaches);

/** The caches, reset when the configured workspace changed since they were filled. */
function caches(): HistoryState {
  const { workspace } = memoryPaths();
  if (h.workspace !== workspace) {
    h.workspace = workspace;
    h.analyses.clear();
    h.fileAnalyses.clear();
    h.records.clear();
    clearHistoryCaches();
  }
  return h;
}

/** A promise cache entry with LRU order; a rejected promise is dropped so the next call retries. */
function memo<T>(map: Map<string, Promise<T>>, key: string, max: number, compute: () => Promise<T>): Promise<T> {
  const hit = map.get(key);
  if (hit) {
    map.delete(key);
    map.set(key, hit);
    return hit;
  }
  const promise = compute();
  map.set(key, promise);
  promise.catch(() => {
    if (map.get(key) === promise) map.delete(key);
  });
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  return promise;
}

// ---------------------------------------------------------------------------------------------
// Parsing `git log -z --raw --numstat` (and `git show` with the same options)
// ---------------------------------------------------------------------------------------------

const STATUS_LETTERS: ReadonlySet<string> = new Set(["A", "M", "D", "R", "C", "T"]);
const NUMSTAT_RE = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/;
const COMMIT_SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/**
 * The raw and numstat entries after a commit header, NUL-separated: `:<modes> <shas> <status>`
 * then the path (two paths for R/C), and `<adds>\t<dels>\t<path>` (or `\t\0<old>\0<new>` for a
 * rename). Binary files have `-` counts (null here).
 */
function parseChanges(body: string): RawFile[] {
  const tokens = body.split("\0");
  const files: RawFile[] = [];
  const byPath = new Map<string, RawFile>();
  let i = 0;
  while (i < tokens.length) {
    // The diff part opens with a line feed after the header's NUL.
    const token = tokens[i].replace(/^\n+/, "");
    if (token.startsWith(":")) {
      const letter = token.slice(token.lastIndexOf(" ") + 1).charAt(0);
      const pair = letter === "R" || letter === "C";
      const oldPath = pair ? (tokens[i + 1] ?? null) : null;
      const filePath = pair ? tokens[i + 2] : tokens[i + 1];
      i += pair ? 3 : 2;
      if (filePath === undefined || filePath === "") continue;
      // U (unmerged) and X (unknown) never appear in a commit's diff; fold anything else into M.
      const file: RawFile = { status: (STATUS_LETTERS.has(letter) ? letter : "M") as MemoryChangeStatus, path: filePath, oldPath, additions: null, deletions: null };
      files.push(file);
      byPath.set(filePath, file);
      continue;
    }
    const m = NUMSTAT_RE.exec(token);
    if (!m) {
      i += 1;
      continue;
    }
    let filePath: string | undefined = m[3];
    if (filePath === "") {
      filePath = tokens[i + 2];
      i += 3;
    } else i += 1;
    const file = filePath === undefined ? undefined : byPath.get(filePath);
    if (file) {
      file.additions = m[1] === "-" ? null : Number(m[1]);
      file.deletions = m[2] === "-" ? null : Number(m[2]);
    }
  }
  return files.filter((f) => f.path.startsWith(MEMORY_VAULT_PREFIX) || f.oldPath?.startsWith(MEMORY_VAULT_PREFIX));
}

function parseLog(stdout: string): RawCommit[] {
  const out: RawCommit[] = [];
  for (const record of stdout.split("\x1e")) {
    if (record.trim() === "") continue;
    const headerEnd = record.indexOf("\0");
    const header = headerEnd === -1 ? record.replace(/\n+$/, "") : record.slice(0, headerEnd);
    const [sha = "", shortSha = "", parents = "", name = "", email = "", authoredAt = "", committedAt = "", ...subject] = header.split("\x1f");
    if (!COMMIT_SHA_RE.test(sha)) continue;
    out.push({
      sha,
      shortSha: shortSha || sha.slice(0, 7),
      parents: parents.split(" ").filter(Boolean),
      author: { name, email },
      authoredAt,
      committedAt,
      subject: subject.join("\x1f"),
      files: headerEnd === -1 ? [] : parseChanges(record.slice(headerEnd + 1)),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Files, totals and events
// ---------------------------------------------------------------------------------------------

type TitleOf = (noteId: string) => string | null;
const NO_TITLES: TitleOf = () => null;

function noteIdOf(workspaceRel: string | null): string | null {
  const vaultRel = workspaceRel ? vaultRelativePath(workspaceRel) : null;
  return vaultRel ? noteIdForPath(vaultRel) : null;
}

const isNoteFile = (f: RawFile) => noteIdOf(f.path) !== null || noteIdOf(f.oldPath) !== null;

/** What a file change does to the set of notes; null for a vault file that is not a note on either side. */
function noteEffect(f: RawFile): "added" | "changed" | "removed" | "renamed" | null {
  const isNote = noteIdOf(f.path) !== null;
  const wasNote = noteIdOf(f.oldPath) !== null;
  switch (f.status) {
    case "A":
    case "C":
      return isNote ? "added" : null;
    case "D":
      return isNote ? "removed" : null;
    case "R":
      // Moving a note out of (or into) the note layout removes (or adds) a note.
      return isNote && wasNote ? "renamed" : isNote ? "added" : wasNote ? "removed" : null;
    default:
      return isNote ? "changed" : null;
  }
}

/** Notes first, then the other vault files, each by path. */
function sortFiles<T extends RawFile>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => Number(isNoteFile(b)) - Number(isNoteFile(a)) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function noteLines(files: readonly RawFile[]): number {
  return files.filter(isNoteFile).reduce((sum, f) => sum + (f.additions ?? 0) + (f.deletions ?? 0), 0);
}

function fileChange(f: RawFile & { untracked?: boolean }, titleOf: TitleOf): MemoryFileChange {
  const noteId = noteIdOf(f.path);
  const change: MemoryFileChange = {
    status: f.status,
    path: f.path,
    oldPath: f.oldPath,
    noteId,
    oldNoteId: noteIdOf(f.oldPath),
    title: noteId ? titleOf(noteId) : null,
    additions: f.additions,
    deletions: f.deletions,
  };
  if (f.untracked) change.untracked = true;
  return change;
}

function totalsOf(files: readonly RawFile[], claims: MemoryClaimCounts): MemoryTimelineTotals {
  const totals: MemoryTimelineTotals = { notesAdded: 0, notesChanged: 0, notesRemoved: 0, notesRenamed: 0, otherFiles: 0, linesAdded: 0, linesRemoved: 0, claims };
  for (const f of files) {
    const effect = noteEffect(f);
    if (effect === "added") totals.notesAdded += 1;
    else if (effect === "changed") totals.notesChanged += 1;
    else if (effect === "removed") totals.notesRemoved += 1;
    else if (effect === "renamed") totals.notesRenamed += 1;
    else totals.otherFiles += 1;
    totals.linesAdded += f.additions ?? 0;
    totals.linesRemoved += f.deletions ?? 0;
  }
  return totals;
}

/** A seed or an import: adds ≥ 10 notes and ≥ 80% of its note changes are additions. */
function isBulk(t: MemoryTimelineTotals): boolean {
  const noteChanges = t.notesAdded + t.notesChanged + t.notesRemoved + t.notesRenamed;
  return t.notesAdded >= 10 && t.notesAdded >= 0.8 * noteChanges;
}

function claimCounts(analysis: CommitAnalysis): MemoryClaimCounts {
  return countClaimChanges(analysis.files.flatMap((f) => f.changes));
}

function claimsFor(analysis: CommitAnalysis, filePath: string): MemoryClaimChange[] {
  return analysis.files.find((f) => f.path === filePath)?.changes ?? [];
}

function toEvent(c: RawCommit, analysis: CommitAnalysis, titleOf: TitleOf): MemoryTimelineEvent {
  const totals = totalsOf(c.files, claimCounts(analysis));
  return {
    kind: SIGNOFF_RE.test(c.subject) ? "signoff" : "commit",
    sha: c.sha,
    shortSha: c.shortSha,
    parents: c.parents,
    subject: c.subject,
    author: c.author,
    authoredAt: c.authoredAt,
    committedAt: c.committedAt,
    project: SIGNOFF_RE.exec(c.subject)?.[1] ?? null,
    bulk: isBulk(totals),
    files: sortFiles(c.files).slice(0, EVENT_FILES_MAX).map((f) => fileChange(f, titleOf)),
    totals,
    claimsAnalysed: analysis.state,
  };
}

function workingEvent(w: WorkingState, titleOf: TitleOf): MemoryTimelineEvent {
  const totals = totalsOf(w.files, claimCounts(w.analysis));
  const at = new Date(w.at).toISOString();
  return {
    kind: "uncommitted",
    sha: MEMORY_WORKING_SHA,
    shortSha: MEMORY_WORKING_SHA,
    parents: w.head ? [w.head] : [],
    subject: `Uncommitted changes to ${plural(w.files.length, "vault file")}`,
    author: null,
    authoredAt: at,
    committedAt: at,
    project: null,
    bulk: isBulk(totals),
    files: sortFiles(w.files).slice(0, EVENT_FILES_MAX).map((f) => fileChange(f, titleOf)),
    totals,
    claimsAnalysed: w.analysis.state,
  };
}

/**
 * Current note titles from the cached snapshot. Never the reason an index build starts (none
 * when the index is missing or building) and never a long wait: after TITLE_WAIT_MS the payload
 * goes without titles (the UI falls back to its own overview cache).
 */
async function currentTitles(): Promise<TitleOf> {
  if (!checkVault().indexExists || memoryIndexBuilding()) return NO_TITLES;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const snap = await Promise.race([
      getSnapshot(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), TITLE_WAIT_MS);
      }),
    ]);
    return snap ? (id) => snap.byId.get(id)?.card.title ?? null : NO_TITLES;
  } catch {
    return NO_TITLES;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------------
// Claim analyses
// ---------------------------------------------------------------------------------------------

async function runClaimDiff(args: readonly string[]): Promise<CommitAnalysis> {
  try {
    const { stdout, truncated } = await runGit(args, { maxBuffer: CLAIM_DIFF_MAX });
    return { state: truncated ? "truncated" : "yes", files: claimChangesByFile(stdout) };
  } catch (err) {
    // Missing git or repository surfaces from the log call that came first; here it only means "not counted".
    if (isMemoryGitError(err) && (err.kind === "no-git" || err.kind === "not-a-repo")) throw err;
    return { state: "failed", files: [] };
  }
}

/** memo for analyses: a "failed" one is dropped once it settles, so the next request tries again. */
function memoAnalysis(map: Map<string, Promise<CommitAnalysis>>, key: string, compute: () => Promise<CommitAnalysis>): Promise<CommitAnalysis> {
  const promise = memo(map, key, ANALYSES_MAX, compute);
  void promise.then(
    (a) => {
      if (a.state === "failed" && map.get(key) === promise) map.delete(key);
    },
    () => undefined,
  );
  return promise;
}

/** The claim changes of one commit's note files, cached by sha. */
function analyseCommit(c: RawCommit): Promise<CommitAnalysis> {
  return memoAnalysis(caches().analyses, c.sha, async () => {
    if (!c.files.some(isNoteFile)) return { state: "yes", files: [] };
    if (noteLines(c.files) > TOO_LARGE_LINES) return { state: "too-large", files: [] };
    return runClaimDiff(["show", "-U0", "--format=", "--root", "-M", "--diff-merges=first-parent", CLAIM_PICKAXE, ...DIFF_ARGS, c.sha, "--", MEMORY_VAULT_PREFIX]);
  });
}

/** One note's claim changes in a commit: the commit's own analysis when it exists, else a diff of just that file. */
function analyseFile(sha: string, file: RawFile): Promise<CommitAnalysis> {
  const state = caches();
  const whole = state.analyses.get(sha);
  if (whole) return whole;
  return memoAnalysis(state.fileAnalyses, `${sha}\0${file.path}`, async () => {
    if (!isNoteFile(file)) return { state: "yes", files: [] };
    if ((file.additions ?? 0) + (file.deletions ?? 0) > TOO_LARGE_LINES) return { state: "too-large", files: [] };
    const specs = [file.path, ...(file.oldPath ? [file.oldPath] : [])].map(literal);
    return runClaimDiff(["show", "-U0", "--format=", "--root", "-M", "--diff-merges=first-parent", CLAIM_PICKAXE, ...DIFF_ARGS, sha, "--", ...specs]);
  });
}

// ---------------------------------------------------------------------------------------------
// The working tree
// ---------------------------------------------------------------------------------------------

interface DiskFile {
  /** Null when the file is binary, missing or not a regular file. */
  text: string | null;
  /** The text is the first DISK_READ_MAX bytes only. */
  cut: boolean;
  mtimeMs: number | null;
}

/** A vault file read from disk without following symlinks, capped at DISK_READ_MAX bytes. */
function readVaultFile(workspaceRel: string): DiskFile {
  const { workspace, vaultDir } = memoryPaths();
  const abs = path.resolve(workspace, workspaceRel);
  if (!abs.startsWith(vaultDir + path.sep)) return { text: null, cut: false, mtimeMs: null };
  try {
    const st = fs.lstatSync(abs);
    if (!st.isFile()) return { text: null, cut: false, mtimeMs: st.mtimeMs };
    const size = Math.min(st.size, DISK_READ_MAX);
    const buf = Buffer.alloc(size);
    const fd = fs.openSync(abs, "r");
    try {
      fs.readSync(fd, buf, 0, size, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (buf.includes(0)) return { text: null, cut: false, mtimeMs: st.mtimeMs };
    let text = buf.toString("utf8");
    const cut = st.size > DISK_READ_MAX;
    if (cut) text = text.slice(0, text.lastIndexOf("\n") + 1);
    return { text, cut, mtimeMs: st.mtimeMs };
  } catch {
    return { text: null, cut: false, mtimeMs: null };
  }
}

function textLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** A git-style new-file diff for a file git cannot diff (untracked, or no HEAD yet). */
function newFileDiff(workspaceRel: string, file: DiskFile): string {
  const header = `diff --git a/${workspaceRel} b/${workspaceRel}\nnew file mode 100644\n`;
  if (file.text === null) return `${header}Binary files /dev/null and b/${workspaceRel} differ\n`;
  const lines = textLines(file.text);
  if (lines.length === 0) return header;
  const noNewline = !file.text.endsWith("\n") ? "\n\\ No newline at end of file" : "";
  return `${header}--- /dev/null\n+++ b/${workspaceRel}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}${noNewline}\n`;
}

/** `XY path` entries of `status --porcelain=v1 -z --no-renames`, made workspace-relative. */
function parsePorcelain(stdout: string, prefix: string): Array<{ x: string; y: string; path: string }> {
  const out: Array<{ x: string; y: string; path: string }> = [];
  for (const entry of stdout.split("\0")) {
    if (entry.length < 4) continue;
    const rel = stripPrefix(entry.slice(3), prefix);
    if (rel?.startsWith(MEMORY_VAULT_PREFIX)) out.push({ x: entry[0], y: entry[1], path: rel });
  }
  return out;
}

/** HEAD versus the working tree, per porcelain entry; null when the two agree (added then deleted). */
function workingStatus(x: string, y: string): { status: MemoryChangeStatus; untracked: boolean } | null {
  if (x === "?" && y === "?") return { status: "A", untracked: true };
  if (x === "A" && y === "D") return null;
  if (x === "D" || y === "D") return { status: "D", untracked: false };
  if (x === "A") return { status: "A", untracked: false };
  if (x === "T" || y === "T") return { status: "T", untracked: false };
  return { status: "M", untracked: false };
}

function parseNumstatZ(stdout: string): Map<string, { additions: number | null; deletions: number | null }> {
  const out = new Map<string, { additions: number | null; deletions: number | null }>();
  for (const token of stdout.split("\0")) {
    const m = NUMSTAT_RE.exec(token.replace(/^\n+/, ""));
    if (m && m[3] !== "") out.set(m[3], { additions: m[1] === "-" ? null : Number(m[1]), deletions: m[2] === "-" ? null : Number(m[2]) });
  }
  return out;
}

async function computeWorking(repo: Extract<GitRepoState, { ok: true }>): Promise<WorkingState | null> {
  const { stdout } = await runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames", "--", MEMORY_VAULT_PREFIX]);
  const files: WorkingFile[] = [];
  const seen = new Set<string>();
  for (const e of parsePorcelain(stdout, repo.prefix)) {
    const s = workingStatus(e.x, e.y);
    // A path deleted from the index but back on disk is listed twice ("D " and "??"); the tracked entry wins.
    if (!s || seen.has(e.path)) continue;
    seen.add(e.path);
    files.push({ status: s.status, path: e.path, oldPath: null, additions: null, deletions: null, untracked: s.untracked, fromDisk: s.untracked || repo.head === null, mtimeMs: null });
  }
  if (files.length === 0) return null;

  const tracked = files.filter((f) => !f.fromDisk);
  const disk = new Map<string, DiskFile>();
  for (const f of files) {
    if (f.status === "D") continue;
    const file = readVaultFile(f.path);
    f.mtimeMs = file.mtimeMs;
    if (f.fromDisk) {
      disk.set(f.path, file);
      f.additions = file.text === null || file.cut ? null : textLines(file.text).length;
      f.deletions = file.text === null || file.cut ? null : 0;
    }
  }
  if (tracked.length > 0) {
    const numstat = parseNumstatZ((await runGit(["diff", "HEAD", "--numstat", "-z", "--no-renames", ...DIFF_ARGS, "--", MEMORY_VAULT_PREFIX])).stdout);
    for (const f of tracked) Object.assign(f, numstat.get(f.path) ?? {});
  }

  let analysis: CommitAnalysis = { state: "yes", files: [] };
  if (noteLines(files) > TOO_LARGE_LINES) analysis = { state: "too-large", files: [] };
  else {
    if (tracked.some(isNoteFile)) analysis = await runClaimDiff(["diff", "HEAD", "-U0", "--no-renames", CLAIM_PICKAXE, ...DIFF_ARGS, "--", MEMORY_VAULT_PREFIX]);
    const fromDisk = files.filter((f) => f.fromDisk && isNoteFile(f)).map((f) => newFileDiff(f.path, disk.get(f.path) ?? { text: null, cut: false, mtimeMs: null }));
    if (fromDisk.length > 0) analysis = { state: analysis.state, files: [...analysis.files, ...claimChangesByFile(fromDisk.join(""))] };
  }

  const mtimes = files.map((f) => f.mtimeMs).filter((t): t is number => t !== null);
  return { head: repo.head, files, analysis, at: mtimes.length > 0 ? Math.max(...mtimes) : Date.now() };
}

function indexMtime(repo: Extract<GitRepoState, { ok: true }>): number {
  try {
    return fs.statSync(path.join(repo.gitDir, "index")).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * The uncommitted vault changes (status, numstat and claims versus HEAD), reused while HEAD, the
 * git generation, the note walk and .git/index are unchanged and for at most WORKING_TTL_MS.
 */
function workingState(repo: Extract<GitRepoState, { ok: true }>): Promise<WorkingState | null> {
  const state = caches();
  const key = `${repo.head ?? ""}|${memoryGitGeneration()}|${vaultWalk().key}|${indexMtime(repo)}`;
  const now = Date.now();
  if (state.working && state.working.key === key && now - state.working.at < WORKING_TTL_MS) return state.working.promise;
  const promise = computeWorking(repo);
  state.working = { key, at: now, promise };
  promise.catch(() => {
    if (state.working?.promise === promise) state.working = undefined;
  });
  return promise;
}

// ---------------------------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------------------------

export interface VaultTimelineOptions {
  /** 1–50; the router caps it. */
  limit?: number;
  /** The opaque cursor from a previous page's `nextCursor`; null/undefined for page 1. */
  before?: string | null;
  kind?: MemoryTimelineKind;
}

function kindArgs(kind: MemoryTimelineKind): string[] {
  if (kind === "all") return [];
  const grep = ["--basic-regexp", "--grep=^memory: sign-off of "];
  return kind === "signoff" ? grep : [...grep, "--invert-grep"];
}

/** One page of first-parent commits that touch the vault, from `pinned`; fetches one extra to know whether more exist. */
function commitPage(pinned: string, offset: number, limit: number, kind: MemoryTimelineKind): Promise<CommitPage> {
  return memo(caches().pages, `${pinned}|${kind}|${offset}|${limit}`, PAGES_MAX, async () => {
    const { stdout, truncated } = await runGit([
      "log",
      "--first-parent",
      "--diff-merges=first-parent",
      "--root",
      "-z",
      "--raw",
      "--numstat",
      "-M",
      LOG_FORMAT,
      ...DIFF_ARGS,
      ...kindArgs(kind),
      "-n",
      String(limit + 1),
      "--skip",
      String(offset),
      pinned,
      "--",
      MEMORY_VAULT_PREFIX,
    ]);
    const commits = parseLog(stdout);
    if (truncated) {
      // The last record may be cut short; drop it unless it is the only one (a single giant commit).
      const kept = commits.length > 1 ? commits.slice(0, Math.min(commits.length - 1, limit)) : commits.slice(0, 1);
      return { commits: kept, more: true, nextOffset: offset + kept.length };
    }
    return { commits: commits.slice(0, limit), more: commits.length > limit, nextOffset: offset + limit };
  });
}

/** Monday of a `YYYY-MM-DD…` date's week, as `YYYY-MM-DD` (calendar arithmetic, no time zone). */
function mondayOf(day: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const sinceMonday = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Zero-filled weeks from the first commit (at most WEEKS_MAX back) to this week; a commit counts in its committer's local week. */
function weeklyBuckets(counts: Map<string, { commits: number; signoffs: number }>, now: number): MemoryTimelineSummary["weeks"] {
  if (counts.size === 0) return [];
  const keys = [...counts.keys()].sort();
  const thisWeek = mondayOf(localDay(now)) ?? keys[keys.length - 1];
  const end = keys[keys.length - 1] > thisWeek ? keys[keys.length - 1] : thisWeek;
  const endMs = Date.parse(`${end}T00:00:00Z`);
  const startMs = Math.max(Date.parse(`${keys[0]}T00:00:00Z`), endMs - (WEEKS_MAX - 1) * 7 * DAY_MS);
  const weeks: MemoryTimelineSummary["weeks"] = [];
  for (let t = startMs; t <= endMs; t += 7 * DAY_MS) {
    const week = new Date(t).toISOString().slice(0, 10);
    weeks.push({ week, ...(counts.get(week) ?? { commits: 0, signoffs: 0 }) });
  }
  return weeks;
}

/** Counts over the whole first-parent history of the vault: one `log --name-only`, cached per HEAD. */
function vaultSummary(head: string): Promise<SummaryBase> {
  const state = caches();
  if (state.summary?.head === head) return state.summary.promise;
  const promise = (async (): Promise<SummaryBase> => {
    const { stdout } = await runGit(
      ["log", "--first-parent", "--diff-merges=first-parent", "--root", "-M", "--name-only", "-z", "--format=%x1e%cI%x1f%s", ...DIFF_ARGS, head, "--", MEMORY_VAULT_PREFIX],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    let commits = 0;
    let signoffs = 0;
    let lastCommitAt: string | null = null;
    const notes = new Set<string>();
    const byWeek = new Map<string, { commits: number; signoffs: number }>();
    for (const record of stdout.split("\x1e")) {
      if (record.trim() === "") continue;
      const tokens = record.split("\0");
      const [committedAt = "", ...subjectParts] = (tokens[0] ?? "").split("\x1f");
      const signoff = SIGNOFF_RE.test(subjectParts.join("\x1f"));
      commits += 1;
      if (signoff) signoffs += 1;
      lastCommitAt ??= committedAt || null;
      const week = mondayOf(committedAt);
      if (week) {
        const bucket = byWeek.get(week) ?? { commits: 0, signoffs: 0 };
        bucket.commits += 1;
        if (signoff) bucket.signoffs += 1;
        byWeek.set(week, bucket);
      }
      for (const token of tokens.slice(1)) {
        const id = noteIdOf(token.replace(/^\n+/, ""));
        if (id) notes.add(id);
      }
    }
    return { commits, signoffs, notesTouched: notes.size, lastCommitAt, weeks: weeklyBuckets(byWeek, Date.now()) };
  })();
  state.summary = { head, promise };
  promise.catch(() => {
    if (state.summary?.promise === promise) state.summary = undefined;
  });
  return promise;
}

const EMPTY_SUMMARY: SummaryBase = { commits: 0, signoffs: 0, notesTouched: 0, lastCommitAt: null, weeks: [] };

/** `<head>.<offset>` → the pinned head (HEAD or one of its ancestors) and the offset. */
async function resolveCursor(before: string, head: string | null): Promise<{ pinned: string; offset: number }> {
  const m = CURSOR_RE.exec(before);
  if (!m) throw new MemoryRequestError(400, "before is not a timeline cursor");
  const pinned = m[1];
  const offset = Number(m[2]);
  if (pinned === head) return { pinned, offset };
  const gone = new MemoryRequestError(404, "The timeline cursor is not in the vault's history any more; reload the timeline");
  if (!head) throw gone;
  const verified = await runGit(["rev-parse", "-q", "--verify", `${pinned}^{commit}`], { okExitCodes: [1] });
  if (verified.exitCode !== 0 || !(await isAncestor(pinned, head))) throw gone;
  return { pinned, offset };
}

export async function vaultTimeline({ limit = DEFAULT_TIMELINE_LIMIT, before = null, kind = "all" }: VaultTimelineOptions = {}): Promise<MemoryTimelinePayload> {
  const repo = await gitState();
  const git = publicGitState(repo);
  if (!repo.ok) return { git, working: null, events: [], nextCursor: null, generatedAt: Date.now() };
  const n = Math.min(Math.max(1, Math.floor(limit)), TIMELINE_LIMIT_MAX);
  const firstPage = !before;
  const { pinned, offset } = before ? await resolveCursor(before, repo.head) : { pinned: repo.head, offset: 0 };

  const [page, working, summary, titleOf] = await Promise.all([
    pinned ? commitPage(pinned, offset, n, kind) : Promise.resolve<CommitPage>({ commits: [], more: false, nextOffset: 0 }),
    // Page 1 always reads the working tree: the summary's last change counts it under every filter.
    firstPage ? workingState(repo) : Promise.resolve(null),
    firstPage ? (repo.head ? vaultSummary(repo.head) : Promise.resolve(EMPTY_SUMMARY)) : Promise.resolve(null),
    currentTitles(),
  ]);
  const analyses = await Promise.all(page.commits.map(analyseCommit));
  const events = page.commits.map((c, i) => toEvent(c, analyses[i], titleOf));
  const workingEntry = working ? workingEvent(working, titleOf) : null;

  const payload: MemoryTimelinePayload = {
    git,
    working: kind === "signoff" ? null : workingEntry,
    events,
    nextCursor: page.more && pinned ? `${pinned}.${page.nextOffset}` : null,
    generatedAt: Date.now(),
  };
  if (summary) {
    const lastChangeAt = workingEntry && (!summary.lastCommitAt || Date.parse(workingEntry.committedAt) > Date.parse(summary.lastCommitAt)) ? workingEntry.committedAt : summary.lastCommitAt;
    payload.summary = { commits: summary.commits, signoffs: summary.signoffs, notesTouched: summary.notesTouched, lastChangeAt, weeks: summary.weeks };
  }
  return payload;
}

// ---------------------------------------------------------------------------------------------
// Note history
// ---------------------------------------------------------------------------------------------

export interface NoteHistoryOptions {
  limit?: number;
}

/** First-parent commits that touched one note, following renames back. */
function followLog(head: string, workspaceRel: string, limit: number): Promise<CommitPage> {
  return memo(caches().follows, `${head}|${workspaceRel}|${limit}`, FOLLOWS_MAX, async () => {
    const { stdout } = await runGit([
      "log",
      "--follow",
      "--first-parent",
      "--diff-merges=first-parent",
      "--root",
      "-z",
      "--raw",
      "--numstat",
      "-M",
      LOG_FORMAT,
      ...DIFF_ARGS,
      "-n",
      String(limit + 1),
      head,
      "--",
      literal(workspaceRel),
    ]);
    const commits = parseLog(stdout).filter((c) => c.files.length > 0);
    return { commits: commits.slice(0, limit), more: commits.length > limit, nextOffset: limit };
  });
}

const analysedCounts = (a: CommitAnalysis, changes: MemoryClaimChange[]) => (a.state === "yes" || a.state === "truncated" ? countClaimChanges(changes) : null);

/** `id` is a valid note id (the router checked the grammar). */
export async function noteHistory(id: string, { limit = DEFAULT_HISTORY_LIMIT }: NoteHistoryOptions = {}): Promise<MemoryNoteHistoryPayload> {
  const vaultRel = notePathForId(id);
  const repo = await gitState();
  const git = publicGitState(repo);
  if (!repo.ok || !vaultRel) return { id, path: vaultRel, git, entries: [], hasMore: false, generatedAt: Date.now() };
  const n = Math.min(Math.max(1, Math.floor(limit)), HISTORY_LIMIT_MAX);
  const workspaceRel = MEMORY_VAULT_PREFIX + vaultRel;

  const [log, working] = await Promise.all([
    repo.head ? followLog(repo.head, workspaceRel, n) : Promise.resolve<CommitPage>({ commits: [], more: false, nextOffset: 0 }),
    workingState(repo),
  ]);

  const entries: MemoryNoteHistoryEntry[] = [];
  const wf = working?.files.find((f) => f.path === workspaceRel);
  if (working && wf) {
    const changes = claimsFor(working.analysis, wf.path);
    entries.push({
      kind: "uncommitted",
      sha: MEMORY_WORKING_SHA,
      shortSha: MEMORY_WORKING_SHA,
      status: wf.status,
      path: wf.path,
      oldPath: null,
      subject: wf.untracked ? "New note, not committed yet" : "Uncommitted changes",
      author: null,
      committedAt: new Date(wf.mtimeMs ?? working.at).toISOString(),
      project: null,
      additions: wf.additions,
      deletions: wf.deletions,
      claims: analysedCounts(working.analysis, changes),
      claimChanges: changes,
    });
  }

  const rows = await Promise.all(
    log.commits.map(async (c): Promise<MemoryNoteHistoryEntry> => {
      // --follow limits the diff to the followed file: one entry (an R pair across a rename).
      const file = c.files[0];
      const analysis = await analyseFile(c.sha, file);
      const changes = claimsFor(analysis, file.path);
      return {
        kind: SIGNOFF_RE.test(c.subject) ? "signoff" : "commit",
        sha: c.sha,
        shortSha: c.shortSha,
        status: file.status,
        path: file.path,
        oldPath: file.oldPath,
        subject: c.subject,
        author: c.author,
        committedAt: c.committedAt,
        project: SIGNOFF_RE.exec(c.subject)?.[1] ?? null,
        additions: file.additions,
        deletions: file.deletions,
        claims: analysedCounts(analysis, changes),
        claimChanges: changes,
      };
    }),
  );
  entries.push(...rows);
  return { id, path: vaultRel, git, entries, hasMore: log.more, generatedAt: Date.now() };
}

// ---------------------------------------------------------------------------------------------
// One commit's diff
// ---------------------------------------------------------------------------------------------

/** A workspace-relative path inside the vault: `memory/…`, no `.`/`..` segments, no backslashes or NULs. */
function checkVaultPath(p: string): void {
  const segments = p.split("/");
  const ok =
    p.length <= PATH_MAX &&
    p.startsWith(MEMORY_VAULT_PREFIX) &&
    p.length > MEMORY_VAULT_PREFIX.length &&
    !p.includes("\0") &&
    !p.includes("\\") &&
    segments.every((s) => s !== "" && s !== "." && s !== "..");
  if (!ok) throw new MemoryRequestError(400, `"${p.slice(0, 200)}" is not a path inside the memory vault`);
}

/** The full sha of a commit that is HEAD or one of its ancestors; 404 otherwise. */
async function resolveCommit(sha: string, head: string | null): Promise<string> {
  const notFound = new MemoryRequestError(404, `No commit ${sha} in the vault's history`);
  if (!head) throw notFound;
  let full: string;
  try {
    const { stdout, exitCode } = await runGit(["rev-parse", "-q", "--verify", `${sha}^{commit}`], { okExitCodes: [1] });
    full = stdout.trim();
    if (exitCode !== 0 || !COMMIT_SHA_RE.test(full)) throw notFound;
  } catch (err) {
    // An ambiguous short sha or an unknown object; a missing git or repository still escapes.
    if (isMemoryGitError(err) && (err.kind === "bad-revision" || err.kind === "failed")) throw notFound;
    throw err;
  }
  // refs/weft/snapshots/* and any other commit outside HEAD's history are not served.
  if (!(await isAncestor(full, head))) throw notFound;
  return full;
}

/** A commit's header and vault files (`git show` never walks, unlike `log -1 <sha> -- path`), cached by sha. */
function commitRecord(full: string): Promise<RawCommit | null> {
  return memo(caches().records, full, RECORDS_MAX, async () => {
    const { stdout } = await runGit(["show", "--root", "-z", "--raw", "--numstat", "-M", "--diff-merges=first-parent", LOG_FORMAT, ...DIFF_ARGS, full, "--", MEMORY_VAULT_PREFIX]);
    return parseLog(stdout)[0] ?? null;
  });
}

function changedLines(files: readonly RawFile[]): number {
  return files.reduce((sum, f) => sum + (f.additions ?? 0) + (f.deletions ?? 0), 0);
}

function tooManyLines(what: string, lines: number, files: number): MemoryRequestError {
  return new MemoryRequestError(400, `${what} changes ${plural(lines, "line")} in ${plural(files, "file")}; pass ?path=memory/… to see one file`);
}

function commitFiles(files: readonly RawFile[], analysis: CommitAnalysis, titleOf: TitleOf): MemoryCommitFile[] {
  return sortFiles(files)
    .slice(0, EVENT_FILES_MAX)
    .map((f) => ({ ...fileChange(f, titleOf), claims: claimsFor(analysis, f.path) }));
}

/** The uncommitted diff: `git diff HEAD` for tracked files, a synthesized new-file diff for the rest. */
async function workingDiff(repo: Extract<GitRepoState, { ok: true }>, filePath: string | undefined): Promise<MemoryCommitDiffPayload> {
  const [working, titleOf] = await Promise.all([workingState(repo), currentTitles()]);
  if (!working) throw new MemoryRequestError(404, "The memory vault has no uncommitted changes");
  const selected = filePath === undefined ? working.files : working.files.filter((f) => f.path === filePath);
  if (filePath !== undefined && selected.length === 0) throw new MemoryRequestError(404, `${filePath} has no uncommitted changes`);
  if (filePath === undefined) {
    const lines = changedLines(working.files);
    if (lines > ALL_FILES_MAX_LINES) throw tooManyLines("The working tree", lines, working.files.length);
  }

  const tracked = selected.filter((f) => !f.fromDisk);
  let diff = "";
  let truncated = false;
  if (tracked.length > 0) {
    const specs = filePath === undefined ? [MEMORY_VAULT_PREFIX] : tracked.map((f) => literal(f.path));
    const out = await runGit(["diff", "HEAD", "-U3", "--no-renames", ...DIFF_ARGS, "--", ...specs], { maxBuffer: DIFF_MAX });
    diff = out.stdout;
    truncated = out.truncated;
  }
  for (const f of sortFiles(selected.filter((x) => x.fromDisk && x.status !== "D"))) {
    if (truncated) break;
    const file = readVaultFile(f.path);
    const piece = newFileDiff(f.path, file);
    if (diff.length + piece.length > DIFF_MAX) {
      truncated = true;
      break;
    }
    diff += piece;
    truncated ||= file.cut;
  }
  return {
    git: publicGitState(repo),
    commit: workingEvent(working, titleOf),
    files: commitFiles(working.files, working.analysis, titleOf),
    path: filePath ?? null,
    diff,
    truncated,
    generatedAt: Date.now(),
  };
}

/** `sha` is a commit sha (7–64 hex) or MEMORY_WORKING_SHA; `path` is workspace-relative under `memory/`. */
export async function commitDiff(sha: string, filePath?: string): Promise<MemoryCommitDiffPayload> {
  if (sha !== MEMORY_WORKING_SHA && !SHA_RE.test(sha)) throw new MemoryRequestError(400, `"${sha.slice(0, 80)}" is not a commit sha`);
  if (filePath !== undefined) checkVaultPath(filePath);
  const repo = await gitState();
  if (!repo.ok) return { git: publicGitState(repo), commit: null, files: [], path: filePath ?? null, diff: "", truncated: false, generatedAt: Date.now() };
  if (sha === MEMORY_WORKING_SHA) return workingDiff(repo, filePath);

  const full = await resolveCommit(sha, repo.head);
  const record = await commitRecord(full);
  if (!record || record.files.length === 0) throw new MemoryRequestError(404, `Commit ${sha} does not change the memory vault`);
  const [analysis, titleOf] = await Promise.all([analyseCommit(record), currentTitles()]);

  let specs: string[];
  let selectedPath: string | null = null;
  if (filePath !== undefined) {
    const file = record.files.find((f) => f.path === filePath || f.oldPath === filePath);
    if (!file) throw new MemoryRequestError(404, `${filePath} is not changed in commit ${record.shortSha}`);
    selectedPath = file.path;
    // Both sides of a rename, so git can pair them again.
    specs = [file.path, ...(file.oldPath ? [file.oldPath] : [])].map(literal);
  } else {
    const lines = changedLines(record.files);
    if (lines > ALL_FILES_MAX_LINES) throw tooManyLines(`Commit ${record.shortSha}`, lines, record.files.length);
    specs = [MEMORY_VAULT_PREFIX];
  }
  const out = await runGit(["show", "-U3", "--format=", "--root", "-M", "--diff-merges=first-parent", ...DIFF_ARGS, full, "--", ...specs], { maxBuffer: DIFF_MAX });
  return {
    git: publicGitState(repo),
    commit: toEvent(record, analysis, titleOf),
    files: commitFiles(record.files, analysis, titleOf),
    path: selectedPath,
    diff: out.stdout,
    truncated: out.truncated,
    generatedAt: Date.now(),
  };
}
