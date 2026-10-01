/**
 * Live invalidation (plan A8, MP3): one recursive fs.watch on the vault per server process. A
 * change to a note file (an Obsidian edit, a memory-update apply, a git pull) drops the cached
 * walk and publishes `{ type: "memory" }` on the bus, so open Memory pages refetch. The derived
 * index, Obsidian's own state and templates are ignored. Started lazily by /api/events, so it
 * only runs while someone is connected; a missing vault is retried on the next connection.
 */
import fs from "node:fs";
import path from "node:path";
import type { Bus } from "@/server/bus";
import { memoryPaths } from "./config";
import { invalidateMemoryWalk } from "./service";

const DEBOUNCE_MS = 600;

interface WatchState {
  watcher?: fs.FSWatcher;
  vaultDir?: string;
  timer?: ReturnType<typeof setTimeout>;
  bus?: Bus;
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
  const { vaultDir } = memoryPaths();
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
