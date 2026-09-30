"use client";

import type { ComponentType } from "react";
import type { StageId } from "@/lib/delivery/types";
import { ArchitectureStageView } from "./architecture";
import { ImplementationStageView } from "./implementation";
import { QaStageView } from "./qa";
import { RequirementsStageView } from "./requirements";
import { SignoffStageView } from "./signoff";

/** Each stage owner (U2-U4) exports one view with exactly these props from stages/<id>/index.tsx. */
export interface StageViewProps {
  projectId: string;
}

const VIEWS: Record<StageId, ComponentType<StageViewProps>> = {
  requirements: RequirementsStageView,
  architecture: ArchitectureStageView,
  implementation: ImplementationStageView,
  qa: QaStageView,
  signoff: SignoffStageView,
};

/** Dispatches /projects/[projectId]/[stage] to the stage's workspace. */
export function StageView({ projectId, stage }: { projectId: string; stage: StageId }) {
  const View = VIEWS[stage];
  return <View projectId={projectId} />;
}
