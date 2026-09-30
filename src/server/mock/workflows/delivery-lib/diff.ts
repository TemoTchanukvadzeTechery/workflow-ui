import "server-only";
/**
 * Git-style unified diffs for the mock dev-task patches. A WorkingTree holds the base (branch
 * point) and current content of every touched file, so the scripts can capture incremental
 * patches (implement, fix, rework) and the cumulative task diff shown at review, with stats that
 * are always computed from the diff text itself.
 */
import { createHash } from "node:crypto";
import { structuredPatch } from "diff";
import type { FileStat } from "@/lib/weft/types";

export interface FileSpec {
  path: string;
  /** Content at the branch point; omit for a new file. */
  before?: string;
  /** Content after the change; omit to delete the file. */
  after?: string;
}

export interface DiffTotals {
  adds: number;
  dels: number;
  files: number;
}

function withNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

/** Git's abbreviated blob id: sha1 over "blob <len>\0<content>". */
export function gitBlobId(content: string): string {
  const body = Buffer.from(content, "utf8");
  return createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${body.length}\0`), body]))
    .digest("hex")
    .slice(0, 7);
}

/** One file's git diff, or "" when nothing changed. */
export function fileDiff(path: string, before: string | undefined, after: string | undefined): string {
  if (before === after) return "";
  const oldText = before === undefined ? "" : withNewline(before);
  const newText = after === undefined ? "" : withNewline(after);
  if (oldText === newText) return "";
  const patch = structuredPatch(`a/${path}`, `b/${path}`, oldText, newText, undefined, undefined, { context: 3 });
  if (!patch || patch.hunks.length === 0) return "";
  const out: string[] = [`diff --git a/${path} b/${path}`];
  const oldId = before === undefined ? "0000000" : gitBlobId(oldText);
  const newId = after === undefined ? "0000000" : gitBlobId(newText);
  if (before === undefined) {
    out.push("new file mode 100644", `index ${oldId}..${newId}`, "--- /dev/null", `+++ b/${path}`);
  } else if (after === undefined) {
    out.push("deleted file mode 100644", `index ${oldId}..${newId}`, `--- a/${path}`, "+++ /dev/null");
  } else {
    out.push(`index ${oldId}..${newId} 100644`, `--- a/${path}`, `+++ b/${path}`);
  }
  for (const h of patch.hunks) {
    // Unified diff quirk: an empty range is written with start - 1.
    const oldStart = h.oldLines === 0 ? h.oldStart - 1 : h.oldStart;
    const newStart = h.newLines === 0 ? h.newStart - 1 : h.newStart;
    out.push(`@@ -${oldStart},${h.oldLines} +${newStart},${h.newLines} @@`);
    out.push(...h.lines);
  }
  return `${out.join("\n")}\n`;
}

/** Per-file stats parsed from a git diff (what weft's /patch?stats=1 reports). */
export function diffStats(diff: string): FileStat[] {
  const stats: FileStat[] = [];
  let cur: FileStat | undefined;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) {
      cur = { path: header[2], adds: 0, dels: 0, status: "modified" };
      stats.push(cur);
      inHunk = false;
      continue;
    }
    if (!cur) continue;
    if (!inHunk) {
      if (line.startsWith("new file mode")) cur.status = "added";
      else if (line.startsWith("deleted file mode")) cur.status = "deleted";
      else if (line.startsWith("Binary files")) cur.status = "binary";
      else if (line.startsWith("@@")) inHunk = true;
      continue;
    }
    if (line.startsWith("@@")) continue;
    if (line.startsWith("+")) cur.adds++;
    else if (line.startsWith("-")) cur.dels++;
  }
  return stats;
}

export function totals(stats: readonly FileStat[]): DiffTotals {
  return {
    adds: stats.reduce((n, s) => n + s.adds, 0),
    dels: stats.reduce((n, s) => n + s.dels, 0),
    files: stats.length,
  };
}

export type TreeSnapshot = ReadonlyMap<string, string | undefined>;

/** Base and current content of the files a task touches, in first-touched order. */
export class WorkingTree {
  private readonly base = new Map<string, string | undefined>();
  private readonly current = new Map<string, string | undefined>();

  constructor(files: readonly FileSpec[] = []) {
    for (const f of files) {
      this.base.set(f.path, f.before);
      this.current.set(f.path, f.before);
    }
  }

  /** Registers a file's branch-point content (undefined = does not exist yet). */
  track(path: string, before?: string): void {
    if (!this.base.has(path)) {
      this.base.set(path, before);
      this.current.set(path, before);
    }
  }

  get(path: string): string | undefined {
    return this.current.get(path);
  }

  has(path: string): boolean {
    return this.current.get(path) !== undefined;
  }

  write(path: string, content: string): void {
    this.track(path);
    this.current.set(path, withNewline(content));
  }

  remove(path: string): void {
    this.track(path);
    this.current.set(path, undefined);
  }

  /** Replaces the first occurrence of `find`; throws so content bugs surface in the smoke test. */
  replace(path: string, find: string, replacement: string): void {
    const text = this.current.get(path);
    if (text === undefined || !text.includes(find)) {
      throw new Error(`WorkingTree.replace: "${find.slice(0, 60)}" not found in ${path}`);
    }
    this.current.set(path, text.replace(find, replacement));
  }

  /** Inserts `insertion` right after the first line containing `anchor`. */
  insertAfter(path: string, anchor: string, insertion: string): void {
    const text = this.current.get(path);
    if (text === undefined) throw new Error(`WorkingTree.insertAfter: ${path} does not exist`);
    const lines = text.split("\n");
    const at = lines.findIndex((l) => l.includes(anchor));
    if (at < 0) throw new Error(`WorkingTree.insertAfter: "${anchor}" not found in ${path}`);
    lines.splice(at + 1, 0, ...insertion.replace(/\n$/, "").split("\n"));
    this.current.set(path, lines.join("\n"));
  }

  /** Inserts `insertion` right before the last line containing `anchor`. */
  insertBeforeLast(path: string, anchor: string, insertion: string): void {
    const text = this.current.get(path);
    if (text === undefined) throw new Error(`WorkingTree.insertBeforeLast: ${path} does not exist`);
    const lines = text.split("\n");
    let at = -1;
    lines.forEach((l, i) => {
      if (l.includes(anchor)) at = i;
    });
    if (at < 0) throw new Error(`WorkingTree.insertBeforeLast: "${anchor}" not found in ${path}`);
    lines.splice(at, 0, ...insertion.replace(/\n$/, "").split("\n"));
    this.current.set(path, lines.join("\n"));
  }

  /** Current content of every tracked file that exists. */
  entries(): Array<{ path: string; content: string }> {
    return [...this.current.entries()].flatMap(([path, content]) => (content === undefined ? [] : [{ path, content }]));
  }

  snapshot(): TreeSnapshot {
    return new Map(this.current);
  }

  private diffAgainst(from: TreeSnapshot | Map<string, string | undefined>): string {
    return [...this.current.keys()].map((p) => fileDiff(p, from.get(p), this.current.get(p))).join("");
  }

  /** Incremental patch since a snapshot (what one step changed). */
  diffSince(snapshot: TreeSnapshot): string {
    return this.diffAgainst(snapshot);
  }

  /** Cumulative task diff: branch point to now. */
  diff(): string {
    return this.diffAgainst(this.base);
  }

  changedSince(snapshot: TreeSnapshot): string[] {
    return [...this.current.keys()].filter((p) => snapshot.get(p) !== this.current.get(p));
  }

  changedFiles(): string[] {
    return [...this.current.keys()].filter((p) => this.base.get(p) !== this.current.get(p));
  }
}
