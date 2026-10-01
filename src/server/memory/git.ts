import "server-only";
/**
 * Read-only git over the po-workspace (plan §1): the vault's history for the Timeline and the
 * committed check of Health. Every call is `git -C <workspace> -c core.quotepath=off …` through
 * execFile (never a shell) with GIT_OPTIONAL_LOCKS=0, so a `status` never rewrites .git/index, and
 * at most two git processes run at once behind a semaphore of their own (the memory CLI's mutex
 * is separate). The repository also holds refs/weft/snapshots/*, which are not ancestors of HEAD:
 * nothing here may pass `--all`. Paths in porcelain and log output are relative to the repository
 * root; `stripPrefix` makes them workspace-relative when the workspace sits in a subfolder.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MEMORY_VAULT_PREFIX, type MemoryGitState, type MemoryGitUnavailableReason } from "@/lib/memory/types";
import { memoryPaths } from "./config";

const MAX_CONCURRENT = 2;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;
const STATE_TTL_MS = 2_000;
const ANCESTOR_CACHE_MAX = 500;

/** Before every command: no quoting of non-ASCII paths, no colour, no signature lines, no fsmonitor daemon. */
const CONFIG_ARGS = ["-c", "core.quotepath=off", "-c", "color.ui=false", "-c", "log.showSignature=false", "-c", "core.fsmonitor=false"];

/** Variables that would point git at another repository, index or object store. */
const REPO_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE", "GIT_PREFIX"];

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/**
 * no-git: git is not on PATH. not-a-repo: the workspace is not inside a repository (or git refuses
 * it, e.g. dubious ownership). bad-revision: an unknown sha, ref or `<rev>:<path>`. timeout: killed
 * after `timeoutMs`. failed: anything else.
 */
export type MemoryGitErrorKind = "no-git" | "not-a-repo" | "bad-revision" | "timeout" | "failed";

export class MemoryGitError extends Error {
  constructor(
    message: string,
    readonly kind: MemoryGitErrorKind,
    readonly args: readonly string[] = [],
    readonly stderr = "",
  ) {
    super(message);
    this.name = "MemoryGitError";
  }
}

/** Duck-typed: Next may load this module once per route bundle (see delivery/util.ts). */
export function isMemoryGitError(err: unknown): err is MemoryGitError {
  return err instanceof Error && err.name === "MemoryGitError" && typeof (err as { kind?: unknown }).kind === "string";
}

const NOT_A_REPO_RE = /not a git repository|cannot change to|dubious ownership/i;
const BAD_REVISION_RE =
  /unknown revision|bad revision|ambiguous argument|needed a single revision|not a valid object name|invalid object name|bad object|not a valid commit|does not exist in '|exists on disk, but not in/i;

function classify(stderr: string, args: readonly string[], exitCode: number): MemoryGitError {
  const firstLine = stderr.split("\n").find((l) => l.trim() !== "")?.replace(/^(fatal|error):\s*/i, "") ?? `exit code ${exitCode}`;
  const message = `git ${args[0] ?? ""} failed: ${firstLine}`;
  if (NOT_A_REPO_RE.test(stderr)) return new MemoryGitError(message, "not-a-repo", args, stderr);
  if (BAD_REVISION_RE.test(stderr)) return new MemoryGitError(message, "bad-revision", args, stderr);
  return new MemoryGitError(message, "failed", args, stderr);
}

// ---------------------------------------------------------------------------------------------
// State (HMR-safe)
// ---------------------------------------------------------------------------------------------

interface GitGlobal {
  /** Processes running now; the semaphore. */
  active: number;
  /** Callers waiting for a slot, FIFO; release hands the slot straight to the next one. */
  waiting: Array<() => void>;
  repo?: { workspace: string; at: number; promise: Promise<GitRepoState> };
  /** `<sha>:<head>` → merge-base --is-ancestor. */
  ancestors: Map<string, boolean>;
  /** Bumped on every detected change of HEAD, refs or `status -- memory/`. */
  generation: number;
  /** Caches to drop on a change, by owner (re-registering a key replaces it, so HMR never stacks them). */
  listeners: Map<string, () => void>;
}

const g: GitGlobal = ((globalThis as { __memoryGit?: GitGlobal }).__memoryGit ??= {
  active: 0,
  waiting: [],
  ancestors: new Map(),
  generation: 0,
  listeners: new Map(),
});

function acquire(): Promise<void> {
  if (g.active < MAX_CONCURRENT) {
    g.active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => g.waiting.push(resolve));
}

function release(): void {
  const next = g.waiting.shift();
  if (next) next();
  else g.active -= 1;
}

// ---------------------------------------------------------------------------------------------
// runGit
// ---------------------------------------------------------------------------------------------

export interface RunGitOptions {
  /** Default 15 s. */
  timeoutMs?: number;
  /** Bytes of stdout kept; past it git is stopped and the output marked truncated. Default 8 MB. */
  maxBuffer?: number;
  /** Exit codes besides 0 that are answers, not failures (1 from `merge-base --is-ancestor`). */
  okExitCodes?: readonly number[];
}

export interface GitOutput {
  stdout: string;
  /** stdout outgrew maxBuffer: git was stopped and the output cut after its last `\n` or NUL. */
  truncated: boolean;
  exitCode: number;
}

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" };
  for (const key of REPO_ENV) delete env[key];
  return env;
}

/** Keep whole records only: everything up to the last line feed or NUL. */
function cutAtLastRecord(stdout: string): string {
  const end = Math.max(stdout.lastIndexOf("\n"), stdout.lastIndexOf("\0"));
  return end >= 0 ? stdout.slice(0, end + 1) : "";
}

function execGit(workspace: string, args: readonly string[], { timeoutMs = DEFAULT_TIMEOUT_MS, maxBuffer = DEFAULT_MAX_BUFFER, okExitCodes = [] }: RunGitOptions): Promise<GitOutput> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", workspace, ...CONFIG_ARGS, ...args],
      { env: gitEnv(), timeout: timeoutMs, maxBuffer, encoding: "utf8", windowsHide: true },
      (err, stdout, stderr) => {
        if (!err) return resolve({ stdout, truncated: false, exitCode: 0 });
        if (err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return resolve({ stdout: cutAtLastRecord(stdout), truncated: true, exitCode: 0 });
        if (err.code === "ENOENT") return reject(new MemoryGitError("git is not installed or not on PATH", "no-git", args));
        if (err.killed) return reject(new MemoryGitError(`git ${args[0] ?? ""} timed out after ${timeoutMs} ms`, "timeout", args, stderr));
        const exitCode = typeof err.code === "number" ? err.code : -1;
        if (okExitCodes.includes(exitCode)) return resolve({ stdout, truncated: false, exitCode });
        reject(classify(stderr, args, exitCode));
      },
    );
  });
}

/**
 * Run one read-only git command in the workspace and return its stdout. Rejects with
 * MemoryGitError. Never pass `--all`, a shell string or user text that starts with `-`; validate
 * shas and paths first, and prefer `:(literal)` pathspecs for user-supplied paths.
 */
export async function runGit(args: readonly string[], opts: RunGitOptions = {}): Promise<GitOutput> {
  const { workspace } = memoryPaths();
  await acquire();
  try {
    return await execGit(workspace, args, opts);
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------------------------
// Repository state (cached 2 s)
// ---------------------------------------------------------------------------------------------

export type GitRepoState =
  | {
      ok: true;
      /** Full sha of HEAD; null on an unborn branch. */
      head: string | null;
      /** Null when HEAD is detached. */
      branch: string | null;
      /** The workspace's path inside the repository, with a trailing `/`; "" at the top level. */
      prefix: string;
      /** Absolute; `HEAD` and `index` live here. */
      gitDir: string;
      /** Absolute; `refs/` and `packed-refs` live here (differs from gitDir in a linked worktree). */
      commonDir: string;
      shallow: boolean;
    }
  | { ok: false; reason: MemoryGitUnavailableReason; message: string };

function readBranch(gitDir: string): string | null {
  try {
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    const m = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function readRepoState(): Promise<GitRepoState> {
  try {
    const { stdout } = await runGit(["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir", "--is-shallow-repository", "--show-prefix"]);
    const [gitDir = "", commonDir = "", shallow = "", prefix = ""] = stdout.split("\n");
    const head = await runGit(["rev-parse", "-q", "--verify", "HEAD^{commit}"], { okExitCodes: [1] });
    const sha = head.exitCode === 0 ? head.stdout.trim() : "";
    return { ok: true, head: sha || null, branch: readBranch(gitDir), prefix, gitDir, commonDir, shallow: shallow.trim() === "true" };
  } catch (err) {
    if (!isMemoryGitError(err)) return { ok: false, reason: "failed", message: err instanceof Error ? err.message : String(err) };
    const reason: MemoryGitUnavailableReason = err.kind === "no-git" || err.kind === "not-a-repo" ? err.kind : "failed";
    return { ok: false, reason, message: err.message };
  }
}

/** HEAD, branch, prefix and git dirs of the workspace's repository. Never rejects. */
export function gitState(): Promise<GitRepoState> {
  const { workspace } = memoryPaths();
  const now = Date.now();
  if (g.repo && g.repo.workspace === workspace && now - g.repo.at < STATE_TTL_MS) return g.repo.promise;
  const promise = readRepoState();
  g.repo = { workspace, at: now, promise };
  return promise;
}

/** The payload-facing MemoryGitState (no server paths). */
export function publicGitState(repo: GitRepoState): MemoryGitState {
  if (!repo.ok) return { ok: false, reason: repo.reason, message: repo.message };
  return { ok: true, head: repo.head, shortHead: repo.head ? repo.head.slice(0, 7) : null, branch: repo.branch, shallow: repo.shallow };
}

/**
 * A repository-root-relative path (porcelain, `log --raw`, `diff`) made workspace-relative; null
 * when it lies outside the workspace.
 */
export function stripPrefix(repoPath: string, prefix: string): string | null {
  if (prefix === "") return repoPath;
  return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : null;
}

/**
 * Whether `sha` is HEAD or one of its ancestors (`merge-base --is-ancestor`), cached. Pass full
 * shas: the answer for two fixed commits never changes. Rejects with bad-revision for an unknown sha.
 */
export async function isAncestor(sha: string, head: string): Promise<boolean> {
  const key = `${sha}:${head}`;
  const hit = g.ancestors.get(key);
  if (hit !== undefined) return hit;
  const { exitCode } = await runGit(["merge-base", "--is-ancestor", sha, head], { okExitCodes: [1] });
  const yes = exitCode === 0;
  g.ancestors.set(key, yes);
  while (g.ancestors.size > ANCESTOR_CACHE_MAX) {
    const oldest = g.ancestors.keys().next().value;
    if (oldest === undefined) break;
    g.ancestors.delete(oldest);
  }
  return yes;
}

// ---------------------------------------------------------------------------------------------
// Change detection (driven by the git watcher in watch.ts)
// ---------------------------------------------------------------------------------------------

/** Drop the cached repository state and ancestry answers. */
export function clearGitCaches(): void {
  g.repo = undefined;
  g.ancestors.clear();
}

/** Bumped on every detected change; caches can include it in their keys. */
export function memoryGitGeneration(): number {
  return g.generation;
}

/**
 * Register a callback for when HEAD, a branch or the vault's git status changes (history and
 * health drop their caches). `key` names the owner: registering it again replaces the callback.
 * Returns an unregister function.
 */
export function onMemoryGitChange(key: string, cb: () => void): () => void {
  g.listeners.set(key, cb);
  return () => {
    if (g.listeners.get(key) === cb) g.listeners.delete(key);
  };
}

/** Called by the watcher once a change is confirmed: clears the git caches and runs every listener. */
export function notifyMemoryGitChange(): void {
  g.generation += 1;
  clearGitCaches();
  for (const [key, cb] of g.listeners) {
    try {
      cb();
    } catch (err) {
      console.error(`[memory] git change listener "${key}" failed:`, err);
    }
  }
}

/**
 * What a commit, checkout, reset or vault edit changes: the branch line and HEAD sha plus every
 * entry of `status -- memory/`, hashed. One git process (porcelain v2 `--branch`, no ahead/behind
 * walk). Null when git is unavailable.
 */
export async function memoryGitSignature(): Promise<string | null> {
  try {
    const { stdout } = await runGit(["status", "--porcelain=v2", "--branch", "--no-ahead-behind", "-z", "--untracked-files=all", "--", MEMORY_VAULT_PREFIX]);
    return createHash("sha1").update(stdout).digest("hex");
  } catch {
    return null;
  }
}
