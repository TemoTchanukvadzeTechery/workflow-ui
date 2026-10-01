import "server-only";
/**
 * GET /api/memory/health (plan §3): gathers the inputs and hands them to evaluateHealth
 * (lib/memory/health-rules.ts), in this order:
 *
 * 1. The cached snapshot. Never read while the index is missing (Home must not trigger the first
 *    build), so the payload is "partial"; while a build runs the answer is "building" (the last
 *    payload when there is one) and the client polls.
 * 2. Lint findings, from the first source that has them: the last index build for the current
 *    vault fingerprint, a lint-aborted build's details, our own cached run, else one
 *    `memory lint` (its exit 2 is data, not an error). At most one lint process per vault change.
 * 3. git: `status` of the vault's note files and the last commit touching memory/, cached on the
 *    fingerprint plus the mtimes of .git/index and logs/HEAD (60 s backstop), dropped when the
 *    git watcher sees a change.
 * 4. The index file and the embeddings state of the last build.
 *
 * `?refresh=1` re-walks the vault and re-runs lint and git.
 */
import fs from "node:fs";
import path from "node:path";
import {
  evaluateHealth,
  FATAL_LINT_RULES,
  isVaultNote,
  type HealthFileChange,
  type HealthInput,
  type HealthLintFinding,
  type HealthNote,
  type HealthUncommittedFile,
} from "@/lib/memory/health-rules";
import { MEMORY_VAULT_PREFIX, vaultRelativePath, type MemoryHealthLastCommit, type MemoryHealthPayload } from "@/lib/memory/types";
import { isMemoryCliError, runMemory } from "./cli";
import { checkVault, memoryPaths } from "./config";
import { gitState, onMemoryGitChange, publicGitState, runGit, stripPrefix, type GitRepoState } from "./git";
import { getSnapshot, invalidateMemoryWalk, lastMemoryBuild, memoryIndexBuilding, vaultWalk, type MemoryBuildRecord, type MemorySnapshot, type SnapshotNote } from "./service";

export interface MemoryHealthOptions {
  /** `?refresh=1`: ignore cached lint and git results and check again. */
  refresh?: boolean;
}

/** Backstop for the git cache: its key misses changes that touch neither the index nor HEAD's log. */
const GIT_TTL_MS = 60_000;

// ---------------------------------------------------------------------------------------------
// State (HMR-safe)
// ---------------------------------------------------------------------------------------------

interface LintResult {
  findings: HealthLintFinding[];
  /** When the findings were produced (the build's time when they came from one). */
  checkedAt: number;
}

interface GitFacts {
  uncommitted: HealthUncommittedFile[];
  lastCommit: MemoryHealthLastCommit | null;
}

interface HealthState {
  /** Our own `lint` run, by vault fingerprint; the promise dedupes concurrent requests. */
  lint?: { key: string; promise: Promise<LintResult> };
  git?: { key: string; at: number; promise: Promise<GitFacts> };
  /** The last full payload, served (marked building) while an index build runs. */
  last?: MemoryHealthPayload;
}

const state: HealthState = ((globalThis as { __memoryHealth?: HealthState }).__memoryHealth ??= {});

// A commit, checkout or stage changes what `status` and `log` report.
onMemoryGitChange("health", () => {
  state.git = undefined;
});

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ---------------------------------------------------------------------------------------------
// Lint
// ---------------------------------------------------------------------------------------------

function isFinding(value: unknown): value is HealthLintFinding {
  const f = value as Partial<HealthLintFinding> | null;
  return !!f && typeof f.rule === "string" && typeof f.path === "string" && typeof f.message === "string";
}

/**
 * Findings carried in a CLI error's details: an aborted build has `{ findings (fatal), lint (all) }`,
 * `lint` with findings has `{ findings }`. Null when the details hold neither.
 */
function findingsOf(details: unknown): HealthLintFinding[] | null {
  if (!details || typeof details !== "object") return null;
  const d = details as { findings?: unknown; lint?: unknown };
  const list: unknown[] | null = Array.isArray(d.lint) ? d.lint : Array.isArray(d.findings) ? d.findings : null;
  return list ? list.filter(isFinding) : null;
}

/** The findings a build recorded against `key`: all of them on success, the abort's on a lint failure. */
function buildFindings(build: MemoryBuildRecord | undefined, key: string): LintResult | null {
  if (!build || build.key !== key) return null;
  if (build.stats) return { findings: build.stats.lint, checkedAt: build.at };
  if (build.failure?.code === 2) {
    const findings = findingsOf(build.failure.details);
    if (findings) return { findings, checkedAt: build.at };
  }
  return null;
}

async function runLint(): Promise<LintResult> {
  const checkedAt = Date.now();
  try {
    const out = await runMemory<{ findings?: unknown[] }>(["lint"]);
    return { findings: (out.findings ?? []).filter(isFinding), checkedAt };
  } catch (err) {
    // Exit 2 with findings in the details is the answer, not a failure.
    if (isMemoryCliError(err) && err.code === 2) {
      const findings = findingsOf(err.details);
      if (findings) return { findings, checkedAt };
    }
    throw err;
  }
}

function lintFindings(key: string, refresh: boolean): Promise<LintResult> {
  if (!refresh) {
    const fromBuild = buildFindings(lastMemoryBuild(), key);
    if (fromBuild) return Promise.resolve(fromBuild);
    if (state.lint?.key === key) return state.lint.promise;
  }
  const promise = runLint();
  state.lint = { key, promise };
  promise.catch(() => {
    if (state.lint?.promise === promise) state.lint = undefined;
  });
  return promise;
}

// ---------------------------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------------------------

type GitRepoOk = Extract<GitRepoState, { ok: true }>;

function mtimeOf(file: string): number {
  try {
    return Math.round(fs.statSync(file).mtimeMs);
  } catch {
    return 0;
  }
}

function changeOf(x: string, y: string): HealthFileChange {
  if (x === "?" && y === "?") return "untracked";
  if (x === "D" || y === "D") return "deleted";
  if (x === "R" || y === "R") return "renamed";
  if (x === "A") return "added";
  return "modified";
}

/** A repository-root-relative path as a vault-relative one; null outside the vault. */
function toVault(repoPath: string, prefix: string): string | null {
  const ws = stripPrefix(repoPath, prefix);
  return ws === null ? null : vaultRelativePath(ws);
}

/**
 * `status --porcelain=v1 -z` entries are `XY <path>`; a rename or copy is followed by one more
 * NUL-terminated field, the path it came from. Only note files are kept.
 */
function parseStatus(stdout: string, prefix: string): HealthUncommittedFile[] {
  const fields = stdout.split("\0");
  const out: HealthUncommittedFile[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (entry.length < 4) continue;
    const x = entry[0];
    const y = entry[1];
    let from: string | null = null;
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      from = fields[i + 1] ?? null;
      i += 1;
    }
    const vaultPath = toVault(entry.slice(3), prefix);
    const oldPath = from === null ? null : toVault(from, prefix);
    const isNote = (vaultPath !== null && isVaultNote(vaultPath)) || (oldPath !== null && isVaultNote(oldPath));
    if (!isNote) continue;
    out.push({ path: vaultPath ?? oldPath!, change: changeOf(x, y), oldPath });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const SEP = "\x1f";

async function lastVaultCommit(repo: GitRepoOk): Promise<MemoryHealthLastCommit | null> {
  // An unborn branch has no log to read.
  if (repo.head === null) return null;
  const { stdout } = await runGit(["log", "-1", `--format=%H${SEP}%an${SEP}%cI${SEP}%s`, "--", MEMORY_VAULT_PREFIX]);
  const line = stdout.trim();
  if (line === "") return null;
  const [sha = "", author = "", at = "", ...subject] = line.split(SEP);
  return { sha, shortSha: sha.slice(0, 7), subject: subject.join(SEP), author, at };
}

async function readGitFacts(repo: GitRepoOk): Promise<GitFacts> {
  const [status, lastCommit] = await Promise.all([
    runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", MEMORY_VAULT_PREFIX]),
    lastVaultCommit(repo),
  ]);
  return { uncommitted: parseStatus(status.stdout, repo.prefix), lastCommit };
}

/**
 * Cached on the vault fingerprint (an edit or an untracked note changes it; the git watcher only
 * sees .git) plus the index and HEAD-log mtimes (a stage or commit changes them).
 */
function gitFacts(repo: GitRepoOk, walkKey: string, refresh: boolean): Promise<GitFacts> {
  const key = [walkKey, repo.head ?? "", mtimeOf(path.join(repo.gitDir, "index")), mtimeOf(path.join(repo.gitDir, "logs", "HEAD"))].join("|");
  const now = Date.now();
  const hit = state.git;
  if (!refresh && hit && hit.key === key && now - hit.at < GIT_TTL_MS) return hit.promise;
  const promise = readGitFacts(repo);
  state.git = { key, at: now, promise };
  promise.catch(() => {
    if (state.git?.promise === promise) state.git = undefined;
  });
  return promise;
}

function gitUnavailable(repo: Extract<GitRepoState, { ok: false }>): string {
  if (repo.reason === "no-git") return "git is not installed on the server";
  if (repo.reason === "not-a-repo") return "The workspace is not a git repository";
  return `git failed: ${repo.message}`;
}

// ---------------------------------------------------------------------------------------------
// Snapshot → checks input
// ---------------------------------------------------------------------------------------------

const listLength = (v: unknown) => (Array.isArray(v) ? v.length : 0);

function healthNote(n: SnapshotNote): HealthNote {
  const p = n.card.props;
  return {
    id: n.card.id,
    type: n.card.type,
    title: n.card.title,
    path: n.card.path,
    status: n.card.status,
    updated: n.card.updated,
    hasOwner: typeof p.owner === "string" && p.owner.trim() !== "",
    tagCount: listLength(p.tags),
    sourceCount: listLength(p.sources),
    claimCount: n.claimCount,
    proposedClaims: n.claims.filter((c) => c.proposed).length,
    linkCount: n.linkCount,
    seedBlocked: typeof p.seed_blocked === "string" ? p.seed_blocked : n.flags.seedBlocked ? "yes" : null,
    dependsOn: n.links.out.filter((l) => l.property === "depends_on").map((l) => l.id),
  };
}

function indexInfo(building: boolean): MemoryHealthPayload["index"] {
  const { indexFile } = memoryPaths();
  let builtAt: number | null = null;
  try {
    builtAt = Math.round(fs.statSync(indexFile).mtimeMs);
  } catch {
    // not built yet
  }
  // The CLI inherits our environment, so MEMORY_NO_EMBEDDINGS=1 means off even before a build.
  const embeddings = lastMemoryBuild()?.stats?.embeddings ?? (process.env.MEMORY_NO_EMBEDDINGS === "1" ? "off" : null);
  return { state: building ? "building" : builtAt !== null ? "ready" : "missing", builtAt, embeddings };
}

// ---------------------------------------------------------------------------------------------
// getMemoryHealth
// ---------------------------------------------------------------------------------------------

export async function getMemoryHealth({ refresh = false }: MemoryHealthOptions = {}): Promise<MemoryHealthPayload> {
  if (refresh) invalidateMemoryWalk();
  const checkedAt = Date.now();
  const repo = await gitState();
  const building = memoryIndexBuilding();

  // Lint and the snapshot would queue behind the build on the CLI mutex: answer now; the client polls.
  if (building && state.last) {
    return { ...state.last, state: "building", index: { ...state.last.index, state: "building" }, git: publicGitState(repo) };
  }

  const errors: MemoryHealthPayload["errors"] = [];
  const reasons: NonNullable<HealthInput["reasons"]> = {};

  // 1. Snapshot. A build that already failed on this vault state (a lint abort) is not retried
  // on every request: the snapshot would rebuild, and lint again, each time. ?refresh=1 retries.
  const prior = lastMemoryBuild();
  const failedBuild = !refresh && prior && prior.failure && prior.key === vaultWalk().key ? prior.failure : null;
  let snap: MemorySnapshot | null = null;
  if (building) reasons.snapshot = "The search index is building";
  else if (!checkVault().indexExists) reasons.snapshot = "The search index has not been built yet";
  else if (failedBuild) {
    reasons.snapshot = `The last index build failed: ${failedBuild.message}`;
    errors.push({ source: "snapshot", message: failedBuild.message });
  } else {
    try {
      snap = await getSnapshot();
    } catch (err) {
      reasons.snapshot = `The vault could not be read: ${messageOf(err)}`;
      errors.push({ source: "snapshot", message: messageOf(err) });
    }
  }
  // After the snapshot: a build it triggered recorded the fingerprint this walk returns.
  const walk = vaultWalk();

  // 2. Lint
  let lint: LintResult | null = null;
  if (building) reasons.lint = "The search index is building";
  else {
    try {
      lint = await lintFindings(walk.key, refresh);
    } catch (err) {
      reasons.lint = `Lint could not run: ${messageOf(err)}`;
      errors.push({ source: "lint", message: messageOf(err) });
    }
  }

  // 3. git
  let facts: GitFacts | null = null;
  if (!repo.ok) {
    reasons.git = gitUnavailable(repo);
    if (repo.reason === "failed") errors.push({ source: "git", message: repo.message });
  } else {
    try {
      facts = await gitFacts(repo, walk.key, refresh);
    } catch (err) {
      reasons.git = `git failed: ${messageOf(err)}`;
      errors.push({ source: "git", message: messageOf(err) });
    }
  }

  // 4. Index
  const index = indexInfo(building);

  const ev = evaluateHealth(
    {
      noteCount: walk.count,
      notes: snap ? [...snap.byId.values()].map(healthNote) : null,
      staleDocs: snap ? snap.stale.map((e) => ({ document: e.document, path: e.path, title: e.title, claims: e.claims })) : null,
      lint: lint?.findings ?? null,
      index: { state: index.state, embeddings: index.embeddings },
      uncommitted: facts?.uncommitted ?? null,
      reasons,
    },
    checkedAt,
  );

  const newest = walk.newest;
  const payload: MemoryHealthPayload = {
    state: building ? "building" : ev.partial ? "partial" : "ready",
    // Mid-build with no earlier payload only git could be checked: no score yet.
    score: building ? null : ev.score,
    band: building ? null : ev.band,
    counts: ev.counts,
    groups: ev.groups,
    checks: ev.checks,
    vault: {
      notes: snap?.stats.notes ?? walk.count,
      claims: snap?.stats.claims ?? 0,
      edges: snap?.stats.edges ?? 0,
      uncommitted: facts ? facts.uncommitted.length : null,
      lastChange: newest ? { id: newest.id, path: newest.path, title: snap?.byId.get(newest.id)?.card.title ?? null, at: Math.round(newest.mtimeMs) } : null,
      lastCommit: facts?.lastCommit ?? null,
    },
    index,
    lint: lint ? { findings: lint.findings.length, fatal: lint.findings.filter((f) => FATAL_LINT_RULES.includes(f.rule)).length, checkedAt: lint.checkedAt } : null,
    git: publicGitState(repo),
    errors,
    checkedAt,
  };
  if (!building) state.last = payload;
  return payload;
}
