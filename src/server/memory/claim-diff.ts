/**
 * Claim changes in a git diff (plan §4): which `^c-<id>` claims a commit (or the working tree)
 * added, retired, removed, edited or promoted. Input is unified patch text (`-U0` is enough: a
 * claim is one line) with workspace-relative paths (`memory/systems/x.md`, i.e. produced with
 * `--relative`). Only note files count (noteIdForPath): README.md's example claims, templates,
 * bases and other vault files never do. Pure: no fs, no spawn.
 *
 * Per note file, the removed and added claim bullets are paired by block id:
 *
 * | before (removed line) | after (added line)       | kind                                   |
 * |-----------------------|--------------------------|----------------------------------------|
 * | none                  | active                   | added                                  |
 * | none                  | `(retired: …)`           | retired                                |
 * | any                   | none                     | removed                                |
 * | active                | `(retired: …)`           | retired (+ supersededBy)               |
 * | retired               | active                   | added (restored)                       |
 * | `(proposed)`          | active, not proposed     | promoted (previousText if the text changed) |
 * | otherwise different   |                          | edited (previousText)                  |
 * | identical             |                          | no change (a line that only moved)     |
 *
 * A claim moved to another note reads as removed from one note and added to the other.
 */
import {
  MEMORY_VAULT_PREFIX,
  noteIdForPath,
  vaultRelativePath,
  type MemoryClaimChange,
  type MemoryClaimCounts,
  type MemoryClaimDelta,
} from "@/lib/memory/types";
import { parseClaimBullet, type ParsedClaimBullet } from "./claim-grammar";

const SUPERSEDED_RE = /superseded by \^?c-([0-9a-f]{6})\b/i;

export function emptyClaimCounts(): MemoryClaimCounts {
  return { added: 0, retired: 0, removed: 0, edited: 0, promoted: 0 };
}

export function countClaimChanges(changes: readonly MemoryClaimChange[]): MemoryClaimCounts {
  const counts = emptyClaimCounts();
  for (const c of changes) counts[c.kind] += 1;
  return counts;
}

// ---------------------------------------------------------------------------------------------
// Unified diff → file sections
// ---------------------------------------------------------------------------------------------

/** One `diff --git` section: its paths (null for /dev/null) and the changed lines without their +/- marker. */
export interface DiffFileSection {
  oldPath: string | null;
  newPath: string | null;
  removed: string[];
  added: string[];
}

/**
 * git C-quotes a path that holds a quote, a backslash or a control character (`"a/x\"y"`). Such
 * a path is never a note (slugs are `[a-z0-9-]`), so it is only unwrapped, not unescaped.
 */
function unquote(raw: string): string {
  return raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
}

/** A `--- a/x` / `+++ b/x` operand: null for /dev/null, else the path without its a/ or b/ prefix. */
function headerPath(operand: string, side: "a/" | "b/"): string | null {
  // git appends a tab after a path that contains a space.
  const raw = unquote(operand.replace(/\t.*$/, "").trim());
  if (raw === "/dev/null") return null;
  return raw.startsWith(side) ? raw.slice(side.length) : raw;
}

/** `diff --git a/x b/y` for an unquoted pair without spaces: the fallback when a section has no ---/+++ lines (binary, mode only). */
const GIT_LINE_RE = /^diff --git a\/(\S+) b\/(\S+)$/;

/**
 * The file sections of a unified git diff (`diff --git` headers, `-U0` or more context). Header
 * lines are read only before a section's first hunk, so a removed line that starts with `--`
 * (shown as `--- …`) is never mistaken for a file header.
 */
export function splitDiffFiles(diff: string): DiffFileSection[] {
  const out: DiffFileSection[] = [];
  let section: (DiffFileSection & { gitLine: string; sawHeader: boolean }) | null = null;
  let inHeader = false;
  const finish = () => {
    if (!section) return;
    if (!section.sawHeader) {
      const m = GIT_LINE_RE.exec(section.gitLine);
      if (m) {
        section.oldPath = m[1];
        section.newPath = m[2];
      }
    }
    out.push({ oldPath: section.oldPath, newPath: section.newPath, removed: section.removed, added: section.added });
  };
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      finish();
      section = { oldPath: null, newPath: null, removed: [], added: [], gitLine: line, sawHeader: false };
      inHeader = true;
      continue;
    }
    if (!section) continue;
    if (inHeader) {
      if (line.startsWith("--- ")) {
        section.oldPath = headerPath(line.slice(4), "a/");
        section.sawHeader = true;
      } else if (line.startsWith("+++ ")) {
        section.newPath = headerPath(line.slice(4), "b/");
        section.sawHeader = true;
      } else if (line.startsWith("rename from ")) {
        section.oldPath = unquote(line.slice("rename from ".length));
        section.sawHeader = true;
      } else if (line.startsWith("rename to ")) {
        section.newPath = unquote(line.slice("rename to ".length));
        section.sawHeader = true;
      } else if (line.startsWith("@@")) {
        inHeader = false;
      }
      continue;
    }
    if (line.startsWith("@@")) continue;
    if (line.startsWith("+")) section.added.push(line.slice(1));
    else if (line.startsWith("-")) section.removed.push(line.slice(1));
    // " " context and "\ No newline at end of file" carry no change.
  }
  finish();
  return out;
}

// ---------------------------------------------------------------------------------------------
// Claim classification
// ---------------------------------------------------------------------------------------------

/** Claim bullets (lines with a `^c-` block id) by bare id; the first occurrence wins. */
function bulletsById(lines: readonly string[]): Map<string, ParsedClaimBullet> {
  const out = new Map<string, ParsedClaimBullet>();
  for (const line of lines) {
    if (!line.includes("^c-")) continue;
    const bullet = parseClaimBullet(line);
    if (bullet?.blockId && !out.has(bullet.blockId)) out.set(bullet.blockId, bullet);
  }
  return out;
}

function sameBullet(a: ParsedClaimBullet, b: ParsedClaimBullet): boolean {
  return a.text === b.text && a.proposed === b.proposed && a.retired === b.retired && JSON.stringify(a.sources) === JSON.stringify(b.sources);
}

function retiredChange(noteId: string, blockId: string, after: ParsedClaimBullet, before?: ParsedClaimBullet): MemoryClaimChange {
  const reason = after.retired ?? "";
  const change: MemoryClaimChange = { kind: "retired", blockId, noteId, text: after.text, reason, supersededBy: SUPERSEDED_RE.exec(reason)?.[1] ?? null };
  if (before && before.text !== after.text) change.previousText = before.text;
  return change;
}

/** The claim changes of one note file, from its removed and added lines (markers stripped). */
export function classifyClaimLines(noteId: string, removed: readonly string[], added: readonly string[]): MemoryClaimChange[] {
  const before = bulletsById(removed);
  const after = bulletsById(added);
  const changes: MemoryClaimChange[] = [];
  for (const [blockId, a] of after) {
    const b = before.get(blockId);
    if (!b) {
      changes.push(a.retired !== null ? retiredChange(noteId, blockId, a) : { kind: "added", blockId, noteId, text: a.text });
      continue;
    }
    if (sameBullet(a, b)) continue;
    if (b.retired === null && a.retired !== null) changes.push(retiredChange(noteId, blockId, a, b));
    else if (b.retired !== null && a.retired === null) changes.push({ kind: "added", blockId, noteId, text: a.text, previousText: b.text });
    else if (b.proposed && !a.proposed && a.retired === null) {
      const change: MemoryClaimChange = { kind: "promoted", blockId, noteId, text: a.text };
      if (b.text !== a.text) change.previousText = b.text;
      changes.push(change);
    } else changes.push({ kind: "edited", blockId, noteId, text: a.text, previousText: b.text });
  }
  for (const [blockId, b] of before) {
    if (!after.has(blockId)) changes.push({ kind: "removed", blockId, noteId, text: b.text });
  }
  return changes;
}

/** The claim changes of one changed note file. */
export interface FileClaimChanges {
  /** Workspace-relative path after the change (before it for a deletion), `memory/…`. */
  path: string;
  noteId: string;
  changes: MemoryClaimChange[];
}

/**
 * Claim changes per note file of a diff whose paths are workspace-relative. Files that are not
 * notes, or whose diff touches no claim line, are left out.
 */
export function claimChangesByFile(diff: string): FileClaimChanges[] {
  const out: FileClaimChanges[] = [];
  for (const section of splitDiffFiles(diff)) {
    const filePath = section.newPath ?? section.oldPath;
    if (!filePath?.startsWith(MEMORY_VAULT_PREFIX)) continue;
    const vaultRel = vaultRelativePath(filePath);
    const noteId = vaultRel ? noteIdForPath(vaultRel) : null;
    if (!noteId) continue;
    const changes = classifyClaimLines(noteId, section.removed, section.added);
    if (changes.length > 0) out.push({ path: filePath, noteId, changes });
  }
  return out;
}

/** `claimDeltas(diff)`: every claim change in the diff's note files, with counts per kind. */
export function claimDeltas(diff: string): MemoryClaimDelta {
  const changes = claimChangesByFile(diff).flatMap((f) => f.changes);
  return { counts: countClaimChanges(changes), changes };
}
