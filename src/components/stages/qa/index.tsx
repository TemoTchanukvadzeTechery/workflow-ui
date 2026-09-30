"use client";

/**
 * Stage 4 · QA Certification (brief C.4). Sub-steps: Tasks · Traceability · Changes & memory ·
 * Final approval. qa-verify agents test each task with evidence; QA certifies or reports bugs
 * (which loop back to implementation); the trace matrix and the change review confirm the
 * delivery matches the requirements; the gate sends the project to PO Review.
 */
import { FolderX, Undo2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { actorText, EmptyState, ErrorState, RelativeTime } from "@/components/common";
import { Notice } from "@/components/hitl";
import { StageLayout, type StageStep } from "@/components/stage";
import { TraceMatrix } from "@/components/trace";
import { Skeleton } from "@/components/ui/skeleton";
import { useStageParams } from "@/hooks/use-stage-params";
import { ApiError } from "@/lib/api/client";
import { useProject } from "@/lib/api/queries";
import { stageDef, type ProjectBundle, type QaStep } from "@/lib/delivery/types";
import { ChangesPanel } from "./ChangesPanel";
import { FinalPanel } from "./FinalPanel";
import { ReviewSheet, type ReviewTarget } from "./ReviewSheet";
import { activeTasks, isLoopedBack, pendingDevReview } from "./shared";
import { TasksPanel } from "./TasksPanel";

const QA_STEPS: QaStep[] = ["tasks", "traceability", "changes", "final"];
const isQaStep = (s: string | null | undefined): s is QaStep => !!s && (QA_STEPS as string[]).includes(s);

/** Stage header, pills and two columns while the project loads. */
export function StageSkeleton({ pills = 4 }: { pills?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading stage">
      <div className="space-y-2">
        <Skeleton className="h-8 w-80 max-w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-28 rounded-full" />
        </div>
        <div className="flex gap-1.5 pt-1">
          {Array.from({ length: pills }, (_, i) => (
            <Skeleton key={i} className="h-8 w-28 rounded-full" />
          ))}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div className="card-surface space-y-3 rounded-2xl p-5">
            <Skeleton className="h-4 w-40" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          </div>
          <div className="card-surface space-y-3 rounded-2xl p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
        <div className="card-surface space-y-3 rounded-2xl p-4">
          <Skeleton className="h-8 w-full rounded-lg" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}

/** Loading, not-found and error handling shared by the Stage 4 and 5 views. */
export function useStageBundle(projectId: string): { bundle?: ProjectBundle; state: ReactNode } {
  const q = useProject(projectId);
  if (q.data) return { bundle: q.data, state: null };
  if (q.isPending) return { state: <StageSkeleton /> };
  if (q.error instanceof ApiError && q.error.status === 404) {
    return { state: <EmptyState icon={FolderX} title="Project not found" body={`No project with id "${projectId}". It may have been deleted, or the demo data was reset.`} /> };
  }
  return { state: <ErrorState title="Could not load the project" error={q.error} onRetry={() => void q.refetch()} /> };
}

export function QaStageView({ projectId }: { projectId: string }) {
  const { bundle, state } = useStageBundle(projectId);
  const { step: urlStep, request } = useStageParams();
  const [localStep, setLocalStep] = useState<QaStep | null>(null);
  const [review, setReview] = useState<ReviewTarget | null>(null);
  // ?request=<runId>:<hId> for a task's qa:review opens the review drawer once.
  const [seenRequest, setSeenRequest] = useState<string | null>(null);
  // A new ?step= in the URL (a link, back/forward) wins over the last pill clicked.
  const [seenUrlStep, setSeenUrlStep] = useState(urlStep);
  if (urlStep !== seenUrlStep) {
    setSeenUrlStep(urlStep);
    setLocalStep(null);
  }
  // With no ?step= and no pill clicked, open on the server's suggested sub-step as of the first
  // load only: a later change (e.g. the last task certified) must not move the person.
  const [landing, setLanding] = useState<{ projectId: string; step: QaStep } | null>(null);
  if (bundle && bundle.project.id === projectId && landing?.projectId !== projectId) {
    const suggested = bundle.stages.qa.step;
    setLanding({ projectId, step: isQaStep(suggested) ? suggested : "tasks" });
  }

  if (!bundle) return <>{state}</>;

  const view = bundle.stages.qa;
  const readOnly = bundle.project.done || view.status === "approved" || view.status === "locked";
  const active: QaStep = localStep ?? (isQaStep(urlStep) ? urlStep : (landing?.step ?? (isQaStep(view.step) ? view.step : "tasks")));
  const requestKey = request ? `${request.runId}:${request.requestId}` : null;
  if (requestKey && requestKey !== seenRequest) {
    setSeenRequest(requestKey);
    const task = bundle.tasks.find((t) => t.qa.runIds.includes(request!.runId));
    if (task && !readOnly) setReview({ taskId: task.id });
  }

  const qaRecord = bundle.project.stages.qa;
  // A send-back from PO Review (or a reopen) after the last approval: say why QA is open again.
  const lastReopen = qaRecord.reopened?.at(-1);
  const tasks = activeTasks(bundle);
  const certified = tasks.filter((t) => t.qa.status === "certified").length;
  const notMet = bundle.trace.filter((r) => r.verdict !== "met" && r.verdict !== "waived").length;
  const unreviewed = bundle.changeReviews.filter((c) => c.consistent === undefined).length;
  const steps: StageStep[] = [
    { id: "tasks", label: "Tasks", badge: tasks.length ? `${certified}/${tasks.length}` : undefined },
    { id: "traceability", label: "Traceability", badge: notMet || undefined },
    { id: "changes", label: "Changes & memory", badge: unreviewed || undefined },
    { id: "final", label: "Final approval" },
  ];
  // Once every task is certified, the Tasks step points at the first sub-step with work left.
  const nextStep: QaStep = notMet ? "traceability" : unreviewed ? "changes" : "final";
  const next = { step: nextStep, label: steps.find((s) => s.id === nextStep)!.label };
  // The Tasks step shows a loop-back's developer review as "Review rework" on its card, so the
  // rail leaves those runs out there.
  const inlineRuns = active === "tasks" && !readOnly ? tasks.filter(isLoopedBack).flatMap((t) => pendingDevReview(bundle, t)?.runId ?? []) : [];

  const go = (s: QaStep) => {
    setLocalStep(s);
    const params = new URLSearchParams(window.location.search);
    params.set("step", s);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <StageLayout
        projectId={projectId}
        stage="qa"
        bundle={bundle}
        steps={steps}
        activeStep={active}
        onStepChange={(id) => isQaStep(id) && setLocalStep(id)}
        focusRequest={requestKey ?? undefined}
        hideRequestsFor={inlineRuns.length ? inlineRuns : undefined}
        gate={{ approveLabel: "Certify & send to PO Review →" }}
      >
        {lastReopen && !readOnly ? (
          <Notice tone="attention" icon={Undo2} role="status">
            <span className="font-medium">{lastReopen.fromStage === "signoff" ? "Sent back from PO Review" : `Reopened from ${stageDef(lastReopen.fromStage).title}`}</span> by {actorText(lastReopen.by)} <RelativeTime at={lastReopen.at} />
            {lastReopen.comment ? <>: &ldquo;{lastReopen.comment}&rdquo;</> : null} Re-test the affected tasks (Re-test on a task row, or tick several and run QA), re-check what changed, then certify again.
          </Notice>
        ) : null}
        {active === "tasks" ? (
          <TasksPanel projectId={projectId} bundle={bundle} readOnly={readOnly} onReview={(taskId) => setReview({ taskId })} next={next} onGo={go} />
        ) : active === "traceability" ? (
          <div className="card-surface rounded-2xl p-5">
            <div className="mb-4 space-y-1">
              <h2 className="text-[20px] leading-7 font-medium tracking-[-0.015em] text-heading">Requirement traceability</h2>
              <p className="text-[13px] leading-5 text-muted-foreground">Every BRD requirement, traced through the AAD and the epics to the tasks, their acceptance criteria and the QA evidence.</p>
            </div>
            <TraceMatrix projectId={projectId} rows={bundle.trace} tasks={bundle.tasks} epics={bundle.epics} evidence={bundle.evidence} readOnly={readOnly} onOpenEvidence={(taskId, evidenceId) => setReview({ taskId, evidenceId })} />
          </div>
        ) : active === "changes" ? (
          <ChangesPanel projectId={projectId} bundle={bundle} readOnly={readOnly} />
        ) : (
          <FinalPanel projectId={projectId} bundle={bundle} onGo={go} />
        )}
      </StageLayout>
      <ReviewSheet projectId={projectId} bundle={bundle} target={review} onClose={() => setReview(null)} />
    </>
  );
}
