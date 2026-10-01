import type { Metadata } from "next";
import { isMemoryNoteId } from "@/lib/memory/types";
import { MemoryNoteView } from "./_view";

type Params = { id: string[] };

/**
 * Note ids contain one slash (`system/customer-service`), so the route is a catch-all whose
 * segments join back into the id. Anything that is not exactly `<known-type>/<slug>` renders the
 * view's not-found state (the note itself is fetched on the client, so no server lookup here).
 */
function noteIdOf(segments: string[]): string {
  return segments
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join("/");
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  const noteId = noteIdOf(id);
  return { title: isMemoryNoteId(noteId) ? `Memory: ${noteId}` : "Note not found" };
}

export default async function MemoryNotePage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  return <MemoryNoteView id={noteIdOf(id)} />;
}
