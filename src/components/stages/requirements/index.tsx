"use client";

/**
 * Stage 1 · Requirements (brief C.1). Sub-steps Intake · Discovery · Drafts · Memory · Epics.
 * The po-brd run is followed live: its dependency review, BRD review rounds and memory review
 * are answered inline where they belong (the rail leaves that run out), ?request= jumps to and
 * highlights the request, and the gate moves the project to Architecture.
 */
import {
  canStartAnother,
  DiscoveryPanel,
  DraftsPanel,
  hasPhase,
  isTerminal,
  MemoryPanel,
  NextStageLink,
  ReviseNotice,
  revisionCause,
  runOutput,
  scrollToStageTop,
  stepForKey,
  useActiveStep,
  useDocRun,
  useRequestFocus,
  useStageBundle,
  WaitingElsewhere,
  type StepDef,
} from "@/components/doc-stage";
import { EpicsPanel, isParked } from "@/components/epics";
import { StageLayout, type StageStep } from "@/components/stage";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ProjectBundle, RequirementsStep } from "@/lib/delivery/types";
import { IntakeStep } from "./IntakeStep";

const LABELS: Record<RequirementsStep, string> = { intake: "Intake", discovery: "Discovery", drafts: "Drafts", memory: "Memory", epics: "Epics" };

function RequirementsWorkspace({ projectId, bundle }: { projectId: string; bundle: ProjectBundle }) {
  const { view, latest, run, runPending, runError, refetchRun, doc, pending } = useDocRun(bundle, "requirements", "brd");
  const focus = useRequestFocus(run);
  const [restart, setRestart] = useState(false);
  const record = bundle.project.stages.requirements;
  const accepted = doc?.status === "accepted";
  const hasRun = !!latest;
  const readOnly = bundle.project.done || view.status === "approved";

  const stepKeys = (prefix: string) => pending.filter((h) => (h.key ?? "").startsWith(prefix)).length;
  const defs: StepDef<RequirementsStep>[] = [
    { id: "intake" },
    { id: "discovery", disabled: !hasRun },
    { id: "drafts", disabled: !doc && !hasPhase(run, /^Draft/) && !isTerminal(run?.status) },
    { id: "memory", disabled: !accepted && !hasPhase(run, /^Update memory/) },
    { id: "epics", disabled: !accepted && bundle.epics.length === 0 },
  ];
  const { active, select, go, follow } = useActiveStep<RequirementsStep>({
    steps: defs,
    serverStep: restart ? "intake" : view.step,
    focusKey: focus.key,
    focusStep: focus.step,
    fallback: "intake",
  });

  const drafts = bundle.epics.filter((e) => e.status === "draft" && !isParked(e)).length;
  const badges: Partial<Record<RequirementsStep, number | undefined>> = {
    discovery: stepKeys("deps:review") || undefined,
    drafts: stepKeys("review:") || undefined,
    memory: stepKeys("memory:review") || undefined,
    epics: bundle.epics.length ? (drafts ? drafts : bundle.epics.length) : undefined,
  };
  const steps: StageStep[] = defs.map((d) => ({ id: d.id, label: LABELS[d.id], disabled: d.disabled, badge: badges[d.id] }));

  // The open request, when it lives on another sub-step than the one shown.
  const waiting = pending[0];
  const waitingStep = stepForKey(waiting?.key) as RequirementsStep | undefined;
  const focusOnRun = focus.onRun ? focus.key : undefined;
  const afterAnswer = () => {
    follow();
    scrollToStageTop();
  };
  const startAnother = () => {
    setRestart(true);
    go("intake");
  };
  // Reopened after the BRD was accepted: offer a new run or an import of a new version.
  const cause = !readOnly && doc ? revisionCause(record) : undefined;
  const revise =
    cause && canStartAnother(run, { revising: true, lastStatus: latest?.status }) ? (
      <ReviseNotice projectId={projectId} kind="brd" cause={cause} doc={doc} onStartAnother={startAnother} hideStart={runOutput(run)?.accepted === false} />
    ) : null;
  const againButton = !readOnly ? (
    <Button size="sm" className="rounded-full" onClick={startAnother}>
      <RotateCcw aria-hidden />
      Start another run
    </Button>
  ) : null;

  return (
    <StageLayout
      projectId={projectId}
      stage="requirements"
      bundle={bundle}
      steps={steps}
      activeStep={active}
      onStepChange={select}
      gate={{ approveLabel: "Approve & move to Architecture" }}
      headerActions={view.status === "approved" && !bundle.project.done ? <NextStageLink projectId={projectId} stage="architecture" title="Architecture" className="hidden @2xl/stage:inline-flex" /> : null}
      hideRequestsFor={latest ? [latest.runId] : undefined}
      focusRequest={focus.key && !focus.onRun ? focus.key : undefined}
    >
      {view.status === "approved" && !bundle.project.done ? <NextStageLink projectId={projectId} stage="architecture" title="Architecture" className="w-full @2xl/stage:hidden" /> : null}
      {waiting && waitingStep && waitingStep !== active ? (
        <WaitingElsewhere workflow="po-brd" question={waiting.question} stepLabel={LABELS[waitingStep]} onGo={() => go(waitingStep)} />
      ) : null}

      {active === "intake" ? (
        <IntakeStep
          projectId={projectId}
          bundle={bundle}
          run={run}
          restart={restart}
          onRestart={setRestart}
          readOnly={readOnly}
          onStarted={() => go("discovery")}
          onImported={() => go("epics")}
        />
      ) : null}

      {active === "discovery" ? (
        <DiscoveryPanel
          projectId={projectId}
          kind="brd"
          runId={latest?.runId}
          run={run}
          runPending={runPending}
          runError={runError}
          onRetry={refetchRun}
          doc={doc}
          focus={focusOnRun}
          onAnswered={afterAnswer}
          emptyAction={
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => go("intake")}>
              Go to Intake
            </Button>
          }
        />
      ) : null}

      {active === "drafts" ? (
        <DraftsPanel
          projectId={projectId}
          kind="brd"
          doc={doc}
          runId={latest?.runId}
          run={run}
          runPending={runPending}
          runError={runError}
          onRetry={refetchRun}
          focus={focusOnRun}
          onAnswered={afterAnswer}
          imported={record.imported}
          notAcceptedAction={againButton}
          revise={revise}
        />
      ) : null}

      {active === "memory" ? (
        <MemoryPanel projectId={projectId} bundle={bundle} kind="brd" doc={doc} runId={latest?.runId} run={run} runPending={runPending} runError={runError} onRetry={refetchRun} focus={focusOnRun} onAnswered={afterAnswer} imported={!!record.imported} />
      ) : null}

      {active === "epics" ? <EpicsPanel projectId={projectId} bundle={bundle} readOnly={readOnly} /> : null}

    </StageLayout>
  );
}

export function RequirementsStageView({ projectId }: { projectId: string }) {
  const { bundle, fallback } = useStageBundle(projectId);
  if (!bundle) return <>{fallback}</>;
  return <RequirementsWorkspace projectId={projectId} bundle={bundle} />;
}
