"use client";

/**
 * Stage 3 · Implementation (brief C.3, SPEC 1 decision 3). Sub-steps Plan · Execution (Execution
 * is disabled until the plan is approved). Plan: inputs, developer notes, the system -> repo map,
 * Generate tasks, the live dev-plan status and the plan:review editor. Execution: the agent task
 * board. The gate, "Hand off to QA →", carries the editable Ready-for-test note.
 */
import { FolderX } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState } from "@/components/common";
import { extractHeadings } from "@/components/docs";
import { StageLayout, type NoteAnchorOption, type StageStep } from "@/components/stage";
import { Skeleton } from "@/components/ui/skeleton";
import { useStageParams } from "@/hooks/use-stage-params";
import { ApiError } from "@/lib/api/client";
import { useDoc, useProject } from "@/lib/api/queries";
import type { ProjectBundle } from "@/lib/delivery/types";
import { ExecutionStep } from "./execution-step";
import { HandoffGate } from "./handoff-gate";
import { docOf } from "./inputs";
import { PlanStep } from "./plan-step";

type Step = "plan" | "execution";
const isStep = (s: string | null | undefined): s is Step => s === "plan" || s === "execution";

function StageSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading stage">
      <div className="space-y-2">
        <Skeleton className="h-8 w-96 max-w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-28 rounded-full" />
        </div>
        <div className="flex gap-1.5 pt-1">
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-14 rounded-2xl" />
            ))}
          </div>
          <div className="flex gap-2 overflow-hidden">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="card-surface w-60 shrink-0 space-y-2 rounded-2xl p-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-24 w-full rounded-xl" />
                <Skeleton className="h-24 w-full rounded-xl" />
              </div>
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

/**
 * AAD sections a developer note can be anchored to: level 2 and level 3, so the sections a
 * developer points the planner at (Functional Requirements, High-Level Architecture) are there.
 * A level-3 option names its parent ("Design › High-Level Architecture"); the anchor keeps the
 * section's own heading.
 */
function useAnchorOptions(projectId: string, bundle: ProjectBundle | undefined): NoteAnchorOption[] {
  const aad = bundle ? docOf(bundle, "aad") : undefined;
  const q = useDoc(projectId, aad?.id);
  return useMemo(() => {
    if (!aad || !q.data) return [];
    const out: NoteAnchorOption[] = [];
    const seen = new Set<string>();
    let parent: string | undefined;
    for (const h of extractHeadings(q.data.text)) {
      if (h.depth === 2) parent = h.text;
      if (h.depth !== 2 && h.depth !== 3) continue;
      if (seen.has(h.text)) continue;
      seen.add(h.text);
      out.push({ label: h.depth === 3 && parent ? `AAD §${parent} › ${h.text}` : `AAD §${h.text}`, anchor: { docId: aad.id, section: h.text } });
    }
    return out;
  }, [aad, q.data]);
}

export function ImplementationStageView({ projectId }: { projectId: string }) {
  const q = useProject(projectId);
  const bundle = q.data;
  const { step: urlStep, request } = useStageParams();
  const [localStep, setLocalStep] = useState<Step | null>(null);
  // A new ?step= in the URL (a link, back/forward) wins over the last pill clicked.
  const [seenUrlStep, setSeenUrlStep] = useState(urlStep);
  if (urlStep !== seenUrlStep) {
    setSeenUrlStep(urlStep);
    setLocalStep(null);
  }
  const anchorOptions = useAnchorOptions(projectId, bundle);

  if (!bundle) {
    if (q.isPending) return <StageSkeleton />;
    if (q.error instanceof ApiError && q.error.status === 404) {
      return <EmptyState icon={FolderX} title="Project not found" body={`No project with id "${projectId}". It may have been deleted, or the demo data was reset.`} />;
    }
    return <ErrorState title="Could not load the project" error={q.error} onRetry={() => void q.refetch()} />;
  }

  const view = bundle.stages.implementation;
  const record = bundle.project.stages.implementation;
  const approvedPlan = !!record.planApprovedAt;
  const readOnly = bundle.project.done || view.status === "approved" || view.status === "locked";
  const requestKey = request ? `${request.runId}:${request.requestId}` : undefined;
  const requestOnPlan = !!request && record.planRunIds.includes(request.runId);
  // The page answers the plan:review in the Plan step and lists every task:review (dev-task runs
  // ask nothing else) in Execution's "Reviews waiting on you", which opens the task page; the rail
  // leaves both out instead of repeating them in a cramped copy.
  const inlineRunIds = [...record.planRunIds, ...bundle.tasks.flatMap((t) => t.runIds)];

  const serverStep: Step = view.step === "executing" || view.step === "complete" ? "execution" : "plan";
  let active: Step = localStep ?? (isStep(urlStep) ? urlStep : requestOnPlan ? "plan" : serverStep);
  if (active === "execution" && !approvedPlan) active = "plan";

  const active_ = bundle.tasks.filter((t) => t.status !== "cancelled");
  const done = active_.filter((t) => t.status === "done").length;
  const planPending = bundle.inbox.some((i) => i.kind === "human" && record.planRunIds.includes(i.entry.runId));
  const steps: StageStep[] = [
    { id: "plan", label: "Plan", badge: planPending ? "1" : undefined },
    { id: "execution", label: "Execution", disabled: !approvedPlan, badge: approvedPlan && active_.length ? `${done}/${active_.length}` : undefined },
  ];

  const go = (s: Step) => {
    setLocalStep(s);
    const params = new URLSearchParams(window.location.search);
    params.set("step", s);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <StageLayout
        projectId={projectId}
        stage="implementation"
        bundle={bundle}
        steps={steps}
        activeStep={active}
        onStepChange={(id) => isStep(id) && setLocalStep(id)}
        focusRequest={requestKey}
        hideRequestsFor={inlineRunIds}
        anchorOptions={anchorOptions}
        gate={{ approveLabel: "Hand off to QA →", hide: true }}
      >
        {active === "plan" ? (
          <PlanStep projectId={projectId} bundle={bundle} readOnly={readOnly} focusRequest={requestKey} onOpenExecution={() => go("execution")} />
        ) : (
          <ExecutionStep projectId={projectId} bundle={bundle} canManage={approvedPlan && !readOnly} />
        )}
      </StageLayout>
      <HandoffGate projectId={projectId} bundle={bundle} />
    </div>
  );
}
