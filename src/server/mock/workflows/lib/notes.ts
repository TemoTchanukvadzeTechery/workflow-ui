import "server-only";
/**
 * Loads note entries in order as N1, N2, … (po-brd) or A1, A2, … (architect-aad), as
 * po-brd/lib/notes.ts does: an entry naming an existing workspace file is read from disk
 * (a stat step, then a read step); anything else is used as inline text.
 */
import type { NoteSource } from "../../content/types";
import type { Kit } from "./kit";
import { looksLikePath, sourceBlock } from "./text";

export interface LoadedNotes {
  sources: NoteSource[];
  blocks: string[];
  text: string;
}

export async function loadNotes(kit: Kit, entries: readonly string[], type = "PO notes", prefix = "N"): Promise<LoadedNotes> {
  const sources: NoteSource[] = [];
  for (const [i, entry] of entries.entries()) {
    const path = entry.trim();
    const isFile = looksLikePath(entry) ? (await kit.stat(path)).isFile === true : false;
    const content = isFile ? (await kit.read(path)).content : entry;
    sources.push({ id: `${prefix}${i + 1}`, path: isFile ? path : "inline", content, type, entry });
  }
  return {
    sources,
    blocks: sources.map((s) => sourceBlock(s.id, s.path, s.content, type)),
    text: sources.map((s) => s.content).join("\n\n"),
  };
}
