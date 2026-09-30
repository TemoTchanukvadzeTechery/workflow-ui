"use client";

/**
 * State the Stage 1 and Stage 2 workspaces share: the project bundle (with loading, not-found and
 * error states), the stage's latest document run (live through useRun), the ?request= focus and
 * which sub-step is active. The active step is, in order: the pill the reader just clicked, a
 * newly arrived ?request= (its step), a valid ?step=, the server's derived step (so the page
 * follows a run live from Discovery to Drafts to Memory), then the first step.
 */
import { FolderX } from "lucide-react";
import { useState, type ReactNode } from "react";
import { EmptyState, ErrorState } from "@/components/common";
import { useStageParams } from "@/hooks/use-stage-params";
import { ApiError } from "@/lib/api/client";
import { useProject, useRun } from "@/lib/api/queries";
import type { ProjectBundle } from "@/lib/delivery/types";
import type { HumanState } from "@/lib/weft/types";
import { StageSkeleton } from "./StageBits";
import { latestDocRun, pendingHumans, stageDoc, stepForKey, type DocKind, type DocStageId } from "./run-utils";

/** Loading / not found / error for a stage page; `bundle` once the project is loaded. */
export function useStageBundle(projectId: string): { bundle?: ProjectBundle; fallback: ReactNode } {
  const q = useProject(projectId);
  if (q.data) return { bundle: q.data, fallback: null };
  if (q.isPending) return { fallback: <StageSkeleton /> };
  if (q.error instanceof ApiError && q.error.status === 404) {
    return { fallback: <EmptyState icon={FolderX} title="Project not found" body={`No project with id "${projectId}". It may have been deleted, or the demo data was reset.`} /> };
  }
  return { fallback: <ErrorState title="Could not load the project" error={q.error} onRetry={() => void q.refetch()} /> };
}

export interface StepDef<S extends string> {
  id: S;
  disabled?: boolean;
}

export function useDocRun(bundle: ProjectBundle, stage: DocStageId, kind: DocKind) {
  const view = bundle.stages[stage];
  const latest = latestDocRun(view, kind);
  const runQ = useRun(latest?.runId);
  const run = runQ.data && runQ.data.runId === latest?.runId ? runQ.data : undefined;
  const doc = stageDoc(bundle, kind);
  return {
    view,
    latest,
    run,
    runPending: !!latest && runQ.isPending,
    runError: runQ.error ?? undefined,
    refetchRun: () => void runQ.refetch(),
    doc,
    pending: pendingHumans(run),
  };
}

/** The ?request= focus: its "<runId>:<hId>" key, and the request itself when it is on `run`. */
export function useRequestFocus(run: { runId: string; humans: HumanState[] } | undefined) {
  const { request } = useStageParams();
  const key = request ? `${request.runId}:${request.requestId}` : undefined;
  const human = request && run && request.runId === run.runId ? run.humans.find((h) => h.id === request.requestId) : undefined;
  return { key, human, onRun: !!human, step: stepForKey(human?.key) };
}

export function useActiveStep<S extends string>(opts: { steps: StepDef<S>[]; serverStep: string | undefined; focusKey?: string; focusStep?: S; fallback: S }) {
  const { step: urlStep, setStep: setUrlStep } = useStageParams();
  const [local, setLocal] = useState<S | null>(null);
  // A new ?step= (a link, back/forward, or the pill click writing it) replaces the local choice.
  const [seenUrl, setSeenUrl] = useState(urlStep);
  if (urlStep !== seenUrl) {
    setSeenUrl(urlStep);
    setLocal(null);
  }
  // A newly arrived ?request= opens the step its request belongs to, once.
  const [seenFocus, setSeenFocus] = useState<string | undefined>(undefined);
  if (opts.focusKey && opts.focusStep && opts.focusKey !== seenFocus) {
    setSeenFocus(opts.focusKey);
    setLocal(opts.focusStep);
  }
  const usable = (s: string | null | undefined): s is S => !!s && opts.steps.some((d) => d.id === s && !d.disabled);
  const active: S = usable(local) ? local : usable(urlStep) ? urlStep : usable(opts.serverStep) ? opts.serverStep : opts.fallback;
  return {
    active,
    /** Pill click (StageLayout writes ?step= itself). */
    select: (s: string) => setLocal(s as S),
    /** Programmatic jump that also updates ?step=. */
    go: (s: S) => {
      setLocal(s);
      setUrlStep(s);
    },
    /** Follow the server's step again (after answering a request). */
    follow: () => {
      setLocal(null);
      if (urlStep) setUrlStep(null);
    },
  };
}
