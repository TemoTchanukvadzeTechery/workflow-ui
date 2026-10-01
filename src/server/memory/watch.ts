/**
 * Live invalidation (plan A8, MP3): one recursive fs.watch on the vault per server process. A
 * change to a note file (an Obsidian edit, a memory-update apply, a git pull) drops the cached
 * walk and publishes `{ type: "memory" }` on the bus, so open Memory pages refetch. The derived
 * index, Obsidian's own state and templates are ignored. Started lazily by /api/events, so it
 * only runs while someone is connected; a missing vault is retried on the next connection.
 *
 * A second watcher follows git (plan §1), so a commit shows on the Timeline without a reload: the
 * git dir (HEAD, index, packed-refs) and refs/heads. On an event it recomputes HEAD plus a hash of
 * `status -- memory/` and only when that changed clears the git caches, runs the history/health
 * listeners and publishes. Our own git calls use GIT_OPTIONAL_LOCKS=0, so they never touch the
 * index and cannot retrigger it.
 */
import fs from "node:fs";
import path from "node:path";
import type { Bus } from "@/server/bus";
import { memoryPaths } from "./config";
import { gitState, memoryGitSignature, notifyMemoryGitChange } from "./git";
import { invalidateMemoryWalk } from "./service";

const DEBOUNCE_MS = 600;

/** The files in the git dir whose change can mean a commit, checkout, reset or stage. */
const GIT_DIR_FILES: ReadonlySet<string> = new Set(["HEAD", "index", "packed-refs"]);
const COMMON_DIR_FILES: ReadonlySet<string> = new Set(["packed-refs"]);

interface GitWatchState {
  /** The workspace the watchers belong to; re-armed when the configured path changes. */
  workspace?: string;
  watchers: fs.FSWatcher[];
  /** Arming is async (gitState); true while it runs so a second connection does not arm twice. */
  arming: boolean;
  timer?: ReturnType<typeof setTimeout>;
  /** The last signature seen; a change against it is what gets published. */
  signature?: string | null;
  checking: boolean;
  recheck: boolean;
}

interface WatchState {
  watcher?: fs.FSWatcher;
  vaultDir?: string;
  timer?: ReturnType<typeof setTimeout>;
  bus?: Bus;
  git?: GitWatchState;
}

const state: WatchState = ((globalThis as { __memoryWatch?: WatchState }).__memoryWatch ??= {});

/** A note file or folder, not the index, Obsidian's app state, templates or bases. */
function isNotePath(rel: string): boolean {
  const first = rel.split(/[\\/]/)[0] ?? "";
  if (first.startsWith(".") || first.startsWith("_")) return false;
  return rel.endsWith(".md") || !path.extname(rel);
}

export function ensureMemoryWatch(bus: Bus): void {
  // A Reset rebuilds the runtime with the same bus; a new bus just takes over publishing.
  state.bus = bus;
  const { vaultDir, workspace } = memoryPaths();
  ensureVaultWatch(vaultDir);
  ensureGitWatch(workspace);
}

function ensureVaultWatch(vaultDir: string): void {
  if (state.watcher && state.vaultDir === vaultDir) return;
  state.watcher?.close();
  state.watcher = undefined;
  try {
    const watcher = fs.watch(vaultDir, { recursive: true, persistent: false }, (_event, file) => {
      if (file && !isNotePath(String(file))) return;
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        state.timer = undefined;
        invalidateMemoryWalk();
        state.bus?.publish({ type: "memory" });
      }, DEBOUNCE_MS);
    });
    watcher.on("error", () => {
      watcher.close();
      if (state.watcher === watcher) state.watcher = undefined;
    });
    state.watcher = watcher;
    state.vaultDir = vaultDir;
  } catch {
    // No vault (misconfigured path): the Memory page shows its ErrorState; retry next connection.
  }
}

// ---------------------------------------------------------------------------------------------
// Git watcher
// ---------------------------------------------------------------------------------------------

function closeGitWatch(git: GitWatchState): void {
  for (const w of git.watchers) w.close();
  git.watchers = [];
  if (git.timer) clearTimeout(git.timer);
  git.timer = undefined;
}

function ensureGitWatch(workspace: string): void {
  const git = (state.git ??= { watchers: [], arming: false, checking: false, recheck: false });
  if (git.workspace === workspace && (git.watchers.length > 0 || git.arming)) return;
  closeGitWatch(git);
  git.workspace = workspace;
  git.signature = undefined;
  git.arming = true;
  void armGitWatch(git, workspace).finally(() => {
    if (git.workspace === workspace) git.arming = false;
  });
}

async function armGitWatch(git: GitWatchState, workspace: string): Promise<void> {
  const repo = await gitState();
  // No git or no repository: nothing to watch; the next connection tries again.
  if (!repo.ok || git.workspace !== workspace) return;
  const watchers: fs.FSWatcher[] = [];
  const watch = (dir: string, recursive: boolean, names: ReadonlySet<string> | null) => {
    try {
      const w = fs.watch(dir, { recursive, persistent: false }, (_event, file) => {
        if (names && file && !names.has(String(file))) return;
        scheduleGitCheck(git);
      });
      // A vanished .git (re-clone, deleted repo): drop every watcher; the next connection re-arms.
      w.on("error", () => {
        if (git.watchers.includes(w)) closeGitWatch(git);
        else w.close();
      });
      watchers.push(w);
    } catch {
      // the folder does not exist (no refs/heads yet in a fresh repository)
    }
  };
  watch(repo.gitDir, false, GIT_DIR_FILES);
  if (repo.commonDir !== repo.gitDir) watch(repo.commonDir, false, COMMON_DIR_FILES);
  watch(path.join(repo.commonDir, "refs", "heads"), true, null);
  if (watchers.length === 0) return;
  if (git.workspace !== workspace) {
    for (const w of watchers) w.close();
    return;
  }
  git.watchers = watchers;
  // The baseline: only a difference from it is a change worth publishing.
  git.signature = await memoryGitSignature();
}

function scheduleGitCheck(git: GitWatchState): void {
  if (git.timer) clearTimeout(git.timer);
  git.timer = setTimeout(() => {
    git.timer = undefined;
    void checkGitChange(git);
  }, DEBOUNCE_MS);
}

async function checkGitChange(git: GitWatchState): Promise<void> {
  if (git.checking) {
    git.recheck = true;
    return;
  }
  git.checking = true;
  try {
    const signature = await memoryGitSignature();
    if (signature === null || signature === git.signature) return;
    git.signature = signature;
    notifyMemoryGitChange();
    state.bus?.publish({ type: "memory" });
  } catch {
    // git failed mid-check: keep the old signature; the next event tries again
  } finally {
    git.checking = false;
    if (git.recheck) {
      git.recheck = false;
      scheduleGitCheck(git);
    }
  }
}
