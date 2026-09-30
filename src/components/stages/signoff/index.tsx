"use client";

/**
 * Stage 5 · PO Review (brief C.5). One page, no sub-steps: what was asked, what was delivered
 * and how it was verified. Before the decision a banner says what to check; the gate "Sign off &
 * mark done" and "Send back" (to QA or Implementation, comment required; the GateFooter reopens
 * the chosen stage) sit in the sticky footer. Once signed off the project is done: the done
 * banner is the one confirmation (it carries who, when and the comment, so the footer is left
 * out) and the summary is read-only.
 */
import { StageLayout } from "@/components/stage";
import type { ProjectBundle } from "@/lib/delivery/types";
import { useStageBundle } from "../qa";
import { DecisionsLog, DoneBanner, EpicsProgress, EvidenceHighlights, OpenQuestions, OriginalRequest, QaHistory, ReadyBanner, RequirementVerdicts, SummaryKpis } from "./sections";
import { StageCostChart } from "./StageCostChart";

function Summary({ projectId, bundle }: { projectId: string; bundle: ProjectBundle }) {
  const done = bundle.project.done;
  return (
    <div className="space-y-4">
      {done ? <DoneBanner bundle={bundle} /> : bundle.stages.signoff.status === "in_review" ? <ReadyBanner bundle={bundle} /> : null}
      <SummaryKpis bundle={bundle} />
      <OriginalRequest bundle={bundle} />
      <RequirementVerdicts projectId={projectId} bundle={bundle} />
      <div className="grid gap-4 @3xl/stage:grid-cols-2">
        <EpicsProgress projectId={projectId} bundle={bundle} />
        <StageCostChart bundle={bundle} />
      </div>
      <EvidenceHighlights projectId={projectId} bundle={bundle} />
      <QaHistory projectId={projectId} bundle={bundle} />
      <div className="grid gap-4 @3xl/stage:grid-cols-2">
        <OpenQuestions projectId={projectId} bundle={bundle} />
        <DecisionsLog bundle={bundle} />
      </div>
    </div>
  );
}

export function SignoffStageView({ projectId }: { projectId: string }) {
  const { bundle, state } = useStageBundle(projectId);
  if (!bundle) return <>{state}</>;
  const done = bundle.project.done;
  return (
    <StageLayout
      projectId={projectId}
      stage="signoff"
      bundle={bundle}
      steps={[]}
      activeStep=""
      onStepChange={() => {}}
      syncStepToUrl={false}
      gate={{ approveLabel: "Sign off & mark done", hide: done }}
    >
      <Summary projectId={projectId} bundle={bundle} />
    </StageLayout>
  );
}
