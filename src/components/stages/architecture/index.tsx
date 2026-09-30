"use client";

/**
 * Stage 2 · Architecture (brief C.2). Sub-steps BRD & notes · Discovery · Drafts · Memory · Epic
 * updates. The architect reads the accepted BRD, adds notes, starts architect-aad (or imports an
 * AAD), answers the dependency review, AAD review rounds and memory review inline, checks the FR
 * trace and department acceptance, then accepts the epic updates and approves the gate.
 */
import { RotateCcw } from "lucide-react";
import { useCallback, useState } from "react";
import {
  canStartAnother,
  DiscoveryPanel,
  DraftsPanel,
  hasPhase,
  isTerminal,
  jumpToSource,
  MemoryPanel,
  NextStageLink,
  ReviseNotice,
  revisionCause,
  runOutput,
  scrollToStageTop,
  stageDoc,
  stepForKey,
  useActiveStep,
  useDocRun,
  useRequestFocus,
  useStageBundle,
  WaitingElsewhere,
  type StepDef,
} from "@/components/doc-stage";
import { EpicUpdatesPanel, isParked } from "@/components/epics";
import { StageLayout, type StageStep } from "@/components/stage";
import { Button } from "@/components/ui/button";
import { useDoc } from "@/lib/api/queries";
import type { AadReport, ArchitectureStep, DocumentArtifact, ProjectBundle } from "@/lib/delivery/types";
import { AcceptanceChecklist, FrTrace } from "./AadExtras";
import { BriefStep, useBrdAnchors, type BrdJump } from "./BriefStep";

const LABELS: Record<ArchitectureStep, string> = { brief: "BRD & notes", discovery: "Discovery", drafts: "Drafts", memory: "Memory", epics: "Epic updates" };

/** FR trace + Document Acceptance for the AAD shown in Drafts. */
function AadExtrasBlock({ projectId, aad, brd, onTrace }: { projectId: string; aad: DocumentArtifact; brd?: DocumentArtifact; onTrace: (brId: string) => void }) {
  const text = useDoc(projectId, aad.id);
  const report = aad.lastReport as AadReport | undefined;
  return (
    <>
      <FrTrace frs={aad.frs ?? []} requirements={brd?.requirements ?? []} untraced={report?.untracedRequirements} onTraceClick={onTrace} />
      {text.data ? <AcceptanceChecklist markdown={text.data.text} /> : null}
    </>
  );
}

function ArchitectureWorkspace({ projectId, bundle }: { projectId: string; bundle: ProjectBundle }) {
  const { view, latest, run, runPending, runError, refetchRun, doc: aad, pending } = useDocRun(bundle, "architecture", "aad");
  const brd = stageDoc(bundle, "brd");
  const focus = useRequestFocus(run);
  const [restart, setRestart] = useState(false);
  const [jump, setJump] = useState<BrdJump | undefined>(undefined);
  const anchorOptions = useBrdAnchors(projectId, brd);
  const record = bundle.project.stages.architecture;
  const accepted = aad?.status === "accepted";
  const hasRun = !!latest;
  const readOnly = bundle.project.done || view.status === "approved" || view.status === "locked";

  const defs: StepDef<ArchitectureStep>[] = [
    { id: "brief" },
    { id: "discovery", disabled: !hasRun },
    { id: "drafts", disabled: !aad && !hasPhase(run, /^Draft/) && !isTerminal(run?.status) },
    { id: "memory", disabled: !accepted && !hasPhase(run, /^Update memory/) },
    { id: "epics", disabled: !accepted },
  ];
  const { active, select, go, follow } = useActiveStep<ArchitectureStep>({
    steps: defs,
    serverStep: restart ? "brief" : view.step,
    focusKey: focus.key,
    focusStep: focus.step,
    fallback: "brief",
  });

  const count = (prefix: string) => pending.filter((h) => (h.key ?? "").startsWith(prefix)).length || undefined;
  const changed = bundle.epics.filter((e) => e.changedIn === "architecture" || e.origin === "architecture").length;
  const draftEpics = bundle.epics.filter((e) => e.status === "draft" && !isParked(e)).length;
  const badges: Partial<Record<ArchitectureStep, number | undefined>> = {
    brief: record.notes.filter((n) => !n.sentToRunId).length || undefined,
    discovery: count("deps:review"),
    drafts: count("review:"),
    memory: count("memory:review"),
    epics: accepted && !record.epicUpdatesAcceptedAt ? changed || bundle.epics.length || undefined : draftEpics || undefined,
  };
  const steps: StageStep[] = defs.map((d) => ({ id: d.id, label: LABELS[d.id], disabled: d.disabled, badge: badges[d.id] }));

  const waiting = pending[0];
  const waitingStep = stepForKey(waiting?.key) as ArchitectureStep | undefined;
  const focusOnRun = focus.onRun ? focus.key : undefined;
  const afterAnswer = () => {
    follow();
    scrollToStageTop();
  };

  const traceTo = useCallback(
    (brId: string) => {
      const n = Number(/(\d+)$/.exec(brId)?.[1] ?? 0);
      setJump({ section: "Requirements", ...(n ? { item: n } : {}), nonce: Date.now() });
      go("brief");
    },
    [go],
  );
  const clearJump = useCallback(() => setJump(undefined), []);

  const startAnother = () => {
    setRestart(true);
    go("brief");
  };
  // Reopened, or stale after Requirements changed: offer a new run or an import of a new version.
  const cause = !readOnly && aad ? revisionCause(record) : undefined;
  const revise =
    cause && canStartAnother(run, { revising: true, lastStatus: latest?.status }) ? (
      <ReviseNotice projectId={projectId} kind="aad" cause={cause} doc={aad} onStartAnother={startAnother} hideStart={runOutput(run)?.accepted === false} />
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
      stage="architecture"
      bundle={bundle}
      steps={steps}
      activeStep={active}
      onStepChange={select}
      gate={{ approveLabel: "Approve & move to Implementation" }}
      headerActions={view.status === "approved" && !bundle.project.done ? <NextStageLink projectId={projectId} stage="implementation" title="Implementation" className="hidden @2xl/stage:inline-flex" /> : null}
      hideRequestsFor={latest ? [latest.runId] : undefined}
      focusRequest={focus.key && !focus.onRun ? focus.key : undefined}
      anchorOptions={anchorOptions}
    >
      {view.status === "approved" && !bundle.project.done ? <NextStageLink projectId={projectId} stage="implementation" title="Implementation" className="w-full @2xl/stage:hidden" /> : null}
      {waiting && waitingStep && waitingStep !== active && view.status !== "locked" ? (
        <WaitingElsewhere workflow="architect-aad" question={waiting.question} stepLabel={LABELS[waitingStep]} onGo={() => go(waitingStep)} />
      ) : null}

      {active === "brief" ? (
        <BriefStep
          projectId={projectId}
          bundle={bundle}
          brd={brd}
          run={run}
          restart={restart}
          onRestart={setRestart}
          readOnly={readOnly}
          onStarted={() => go("discovery")}
          onImported={() => go("epics")}
          jump={jump}
          onJumped={clearJump}
          anchorOptions={anchorOptions}
        />
      ) : null}

      {active === "discovery" ? (
        <DiscoveryPanel
          projectId={projectId}
          kind="aad"
          runId={latest?.runId}
          run={run}
          runPending={runPending}
          runError={runError}
          onRetry={refetchRun}
          doc={aad}
          focus={focusOnRun}
          onAnswered={afterAnswer}
          brdPath={brd?.path}
          emptyAction={
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => go("brief")}>
              Go to BRD &amp; notes
            </Button>
          }
        />
      ) : null}

      {active === "drafts" ? (
        <DraftsPanel
          projectId={projectId}
          kind="aad"
          doc={aad}
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
          extras={aad ? <AadExtrasBlock projectId={projectId} aad={aad} brd={brd} onTrace={traceTo} /> : null}
          onCitationClick={(source, part, root) => {
            const m = /§\s*Requirements\s+(\d+)/i.exec(part);
            if (/^B1$/i.test(source.trim()) && m?.[1]) return traceTo(`BR-${m[1]}`);
            jumpToSource(root, source);
          }}
        />
      ) : null}

      {active === "memory" ? (
        <MemoryPanel projectId={projectId} bundle={bundle} kind="aad" doc={aad} runId={latest?.runId} run={run} runPending={runPending} runError={runError} onRetry={refetchRun} focus={focusOnRun} onAnswered={afterAnswer} imported={!!record.imported} />
      ) : null}

      {active === "epics" ? <EpicUpdatesPanel projectId={projectId} bundle={bundle} readOnly={readOnly} /> : null}
    </StageLayout>
  );
}

export function ArchitectureStageView({ projectId }: { projectId: string }) {
  const { bundle, fallback } = useStageBundle(projectId);
  if (!bundle) return <>{fallback}</>;
  return <ArchitectureWorkspace projectId={projectId} bundle={bundle} />;
}
