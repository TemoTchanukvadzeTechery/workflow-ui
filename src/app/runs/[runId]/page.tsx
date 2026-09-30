import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CardSkeleton } from "@/components/common";
import { getRuntime } from "@/server/runtime";
import { RunDetailView } from "./_view";

type Params = { runId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { runId } = await params;
  return { title: (await runExists(runId)) === false ? "Run not found" : `Run ${runId}` };
}

/**
 * Whether the mock engine knows the run, for a real 404. `undefined` when it cannot tell: the
 * lookup failed, or /api/weft proxies to a daemon this process cannot see into (the client view
 * then shows its own not-found state from the API response).
 */
async function runExists(runId: string): Promise<boolean | undefined> {
  try {
    const rt = getRuntime();
    await rt.ready;
    if (rt.settings().dataSource === "weft") return undefined;
    return rt.engine.metaOf(runId) !== undefined;
  } catch {
    return undefined;
  }
}

export default async function RunPage({ params }: { params: Promise<Params> }) {
  const { runId } = await params;
  // Before the Suspense boundary: once a fallback streams, the status is fixed at 200.
  if ((await runExists(runId)) === false) notFound();
  return (
    <Suspense fallback={<CardSkeleton rows={10} />}>
      <RunDetailView runId={runId} />
    </Suspense>
  );
}
