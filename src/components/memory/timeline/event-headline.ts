/**
 * How a vault timeline event reads (plan §4): its node on the rail, its headline, the default file
 * its diff opens on, and the per-file status glyphs. Pure and isomorphic; shared by the rail, the
 * uncommitted band, the diff sheet and the note History card.
 */
import { plural } from "@/lib/format";
import { MEMORY_VAULT_PREFIX, type MemoryChangeStatus, type MemoryFileChange, type MemoryTimelineEvent, type MemoryTimelineTotals } from "@/lib/memory/types";
import type { Tone } from "@/lib/weft/labels";

/**
 * Mirror of the server's limit (history.ts): a commit's whole diff is served only up to this many
 * changed lines; past it the sheet opens on one file.
 */
export const ALL_FILES_MAX_LINES = 4_000;

/** signoff: raised success tile; bulk: a seed or import; files-only: no note changed (a muted dot). */
export type TimelineNodeKind = "signoff" | "bulk" | "commit" | "files-only" | "uncommitted";

/** Notes added, changed, removed or renamed. */
export function noteChangeCount(t: MemoryTimelineTotals): number {
  return t.notesAdded + t.notesChanged + t.notesRemoved + t.notesRenamed;
}

/** Every file the event changed (its `files` list is capped at 500; this is not). */
export function fileCount(t: MemoryTimelineTotals): number {
  return noteChangeCount(t) + t.otherFiles;
}

export function timelineNodeKind(e: MemoryTimelineEvent): TimelineNodeKind {
  if (e.kind === "uncommitted") return "uncommitted";
  if (e.kind === "signoff") return "signoff";
  if (e.bulk) return "bulk";
  if (noteChangeCount(e.totals) === 0 && e.totals.otherFiles > 0) return "files-only";
  return "commit";
}

/** `memory/_templates/x.md` → `_templates/x.md`. */
export function vaultLabel(workspaceRel: string): string {
  return workspaceRel.startsWith(MEMORY_VAULT_PREFIX) ? workspaceRel.slice(MEMORY_VAULT_PREFIX.length) : workspaceRel;
}

/** "brd-memory.md" or "README.md, app.json and 3 more". */
function otherFilesText(e: MemoryTimelineEvent): string {
  const names = e.files.filter((f) => !f.noteId && !f.oldNoteId).map((f) => f.path.split("/").pop() ?? f.path);
  const total = e.totals.otherFiles;
  if (names.length === 0) return plural(total, "file");
  const shown = names.slice(0, 2).join(", ");
  return total > 2 ? `${shown} and ${total - 2} more` : shown;
}

/**
 * The rail's headline. A sign-off reads "Signed off <project>" (the rail links the project), the
 * oldest bulk event "Vault seeded: 42 notes" (`seeded`), other bulk events "Bulk import: N notes",
 * a commit that changed no note "Vault files only: …", any other commit its subject.
 */
export function eventHeadline(e: MemoryTimelineEvent, { seeded = false }: { seeded?: boolean } = {}): string {
  switch (timelineNodeKind(e)) {
    case "uncommitted":
      return "Uncommitted changes";
    case "signoff":
      return `Signed off ${e.project ?? "a project"}`;
    case "bulk":
      return `${seeded ? "Vault seeded" : "Bulk import"}: ${plural(e.totals.notesAdded, "note")}`;
    case "files-only":
      return `Vault files only: ${otherFilesText(e)}`;
    default:
      return e.subject.trim() || "(no commit message)";
  }
}

/**
 * The file a "View diff" opens on: null (every file) when the whole diff is small enough for the
 * server to serve, else the first note file (the list is notes first), else the first file.
 */
export function defaultDiffFile(e: MemoryTimelineEvent): string | null {
  if (e.totals.linesAdded + e.totals.linesRemoved <= ALL_FILES_MAX_LINES) return null;
  return e.files[0]?.path ?? null;
}

export interface FileStatusMeta {
  /** The one-letter git glyph shown in the list. */
  glyph: string;
  /** What the glyph means, for screen readers and the title. */
  label: string;
  tone: Tone;
}

export const FILE_STATUS_META: Record<MemoryChangeStatus, FileStatusMeta> = {
  A: { glyph: "A", label: "Added", tone: "success" },
  M: { glyph: "M", label: "Changed", tone: "neutral" },
  D: { glyph: "D", label: "Removed", tone: "danger" },
  R: { glyph: "R", label: "Renamed", tone: "review" },
  C: { glyph: "C", label: "Copied", tone: "success" },
  T: { glyph: "T", label: "Type changed", tone: "neutral" },
};

/**
 * Whether an uncommitted file blocks po-brd and architect-aad: the port of po-workspace's
 * `isVaultNote` (.weft/lib/memory/index.ts), any file under `memory/` in a folder (or plexus.md)
 * whose path has no `_` or `.` segment. Templates, bases, Obsidian settings and README.md do not.
 */
export function blocksRuns(f: Pick<MemoryFileChange, "path">): boolean {
  if (!f.path.startsWith(MEMORY_VAULT_PREFIX)) return false;
  const parts = vaultLabel(f.path).split("/");
  if (parts.some((part) => part.startsWith("_") || part.startsWith("."))) return false;
  return parts.length > 1 || parts[0] === "plexus.md";
}
