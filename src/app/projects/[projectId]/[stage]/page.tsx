import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/common/skeletons";
import { StageView } from "@/components/stages/StageView";
import { isStageId, stageDef } from "@/lib/delivery/types";

type Params = { projectId: string; stage: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { stage } = await params;
  return { title: isStageId(stage) ? stageDef(stage).title : "Not found" };
}

/**
 * Stage workspace dispatcher. Unknown slugs 404 here; the stage views read `?step=` and
 * `?request=<runId>:<hId>` themselves, hence the Suspense boundary (useSearchParams).
 */
export default async function StagePage({ params }: { params: Promise<Params> }) {
  const { projectId, stage } = await params;
  if (!isStageId(stage)) notFound();
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StageView projectId={projectId} stage={stage} />
    </Suspense>
  );
}
