import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CardSkeleton } from "@/components/common";
import type { DocumentKind } from "@/lib/delivery/types";
import { getRuntime } from "@/server/runtime";
import { DocPageView } from "./_view";

type Params = { projectId: string; docId: string };

const KIND_TITLE: Record<DocumentKind, string> = { brd: "BRD", aad: "AAD", memory: "Shared memory", plan: "Implementation plan", "ready-for-test": "Ready for test" };

/**
 * The project and the document, for the title and a real 404. `undefined` when the lookup itself
 * failed (the client view then decides from the API response); `doc: null` when the project has
 * no such document. An unknown project is the layout's 404.
 */
async function lookupDoc(projectId: string, docId: string) {
  try {
    const rt = getRuntime();
    await rt.ready;
    const pd = rt.store.find(projectId);
    if (!pd) return undefined;
    return { pd, doc: pd.documents.find((d) => d.id === docId) ?? null };
  } catch {
    return undefined;
  }
}

/** "BRD" (the project layout appends the project name); the doc title when it differs. */
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { projectId, docId } = await params;
  const found = await lookupDoc(projectId, docId);
  if (!found) return { title: "Document" };
  if (!found.doc) return { title: "Document not found" };
  const { pd, doc } = found;
  const kind = KIND_TITLE[doc.kind];
  return { title: doc.title === pd.project.name || doc.title === kind ? kind : `${kind}: ${doc.title}` };
}

/** The version (?v=) is read on the client so switching versions needs no server round trip. */
export default async function DocPage({ params }: { params: Promise<Params> }) {
  const { projectId, docId } = await params;
  // Before the Suspense boundary: once a fallback streams, the status is fixed at 200.
  if ((await lookupDoc(projectId, docId))?.doc === null) notFound();
  return (
    <Suspense fallback={<CardSkeleton rows={12} />}>
      <DocPageView projectId={projectId} docId={docId} />
    </Suspense>
  );
}
