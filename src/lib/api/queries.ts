"use client";

/**
 * TanStack Query hooks: the only way UI components read or change data. Queries are refreshed by
 * live.ts (SSE from /api/events) rather than polling. Mutations invalidate what they touch and
 * surface ApiError messages through sonner toasts unless the caller handles onError itself.
 */
import { useMutation, useQuery as useTanstackQuery, useQueryClient, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  stageDef,
  type ChangeReviewBody,
  type CreateProjectBody,
  type DecisionBody,
  type EpicUpsertBody,
  type ImportBody,
  type Intake,
  type NoteBody,
  type QaStartBody,
  type ReopenBody,
  type Settings,
  type StageId,
  type StartArchitectureBody,
  type StartPlanBody,
  type TaskPatchBody,
  type TaskStartBody,
  type WaiveBody,
} from "@/lib/delivery/types";
import type { AnswerBody, RunStatus } from "@/lib/weft/types";
import { delivery, memory, weft } from "./client";
import { qk } from "./keys";

const noopSubscribe = () => () => {};

/** false on the server and during hydration, true afterwards (and on every client-side mount). */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * useQuery that reports "pending" until hydration finishes. Without this, a component that
 * hydrates after another one already fetched the same key (the sidebar and a page both read
 * ["projects"]) renders data on the client where the server rendered a skeleton, and React
 * throws a hydration mismatch. Data views therefore always render after hydration.
 */
function useQuery<TData>(options: Parameters<typeof useTanstackQuery<TData, Error, TData, readonly unknown[]>>[0]): UseQueryResult<TData, Error> {
  const result = useTanstackQuery<TData, Error, TData, readonly unknown[]>(options);
  const hydrated = useHydrated();
  if (hydrated) return result;
  return {
    ...result,
    data: undefined,
    error: null,
    status: "pending",
    fetchStatus: "idle",
    isPending: true,
    isLoading: true,
    isFetching: false,
    isSuccess: false,
    isError: false,
    isLoadingError: false,
    isRefetchError: false,
    isPlaceholderData: false,
  } as unknown as UseQueryResult<TData, Error>;
}

type Opts<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, "queryKey" | "queryFn">;

// ---------------------------------------------------------------------------------------------
// Delivery reads
// ---------------------------------------------------------------------------------------------

export const useDashboard = (o?: Opts<Awaited<ReturnType<typeof delivery.dashboard>>>) =>
  useQuery({ queryKey: qk.dashboard, queryFn: delivery.dashboard, ...o });

export const useProjects = (o?: Opts<Awaited<ReturnType<typeof delivery.projects>>>) =>
  useQuery({ queryKey: qk.projects, queryFn: delivery.projects, ...o });

/** Everything a project page needs (project, derived stage views, docs, epics, tasks, evidence, inbox, activity). */
export const useProject = (id: string | undefined, o?: Opts<Awaited<ReturnType<typeof delivery.project>>>) =>
  useQuery({ queryKey: qk.project(id ?? ""), queryFn: () => delivery.project(id!), enabled: !!id, ...o });

/** Pass `{ placeholderData: keepPreviousData }` to keep the shown version while another one loads. */
export const useDoc = (projectId: string | undefined, docId: string | undefined, v?: number, o?: Opts<Awaited<ReturnType<typeof delivery.doc>>>) =>
  useQuery({
    queryKey: qk.doc(projectId ?? "", docId ?? "", v),
    queryFn: () => delivery.doc(projectId!, docId!, v),
    enabled: !!projectId && !!docId,
    ...o,
  });

export const useInbox = () => useQuery({ queryKey: qk.inbox, queryFn: delivery.inbox });

export const useActivity = (f: { projectId?: string; limit?: number } = {}) =>
  useQuery({ queryKey: qk.activity(f.projectId, f.limit), queryFn: () => delivery.activity(f) });

export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: delivery.settings, staleTime: 5_000 });

export const useWorkspaceFiles = (prefix = "notes/") =>
  useQuery({ queryKey: qk.workspaceFiles(prefix), queryFn: () => delivery.workspaceFiles(prefix), staleTime: 30_000 });

// ---------------------------------------------------------------------------------------------
// Memory vault reads (/api/memory)
// ---------------------------------------------------------------------------------------------

/** Vault/CLI/index health; pass `{ refetchInterval }` while the index is building. */
export const useMemoryStatus = (o?: Opts<Awaited<ReturnType<typeof memory.status>>>) =>
  useQuery({ queryKey: qk.memoryStatus, queryFn: memory.status, staleTime: 5_000, ...o });

export const useMemoryOverview = (o?: Opts<Awaited<ReturnType<typeof memory.overview>>>) =>
  useQuery({ queryKey: qk.memoryOverview, queryFn: memory.overview, staleTime: 15_000, ...o });

/** `id` is `<type>/<slug>`. A 404 (unknown note) surfaces as ApiError with status 404. */
export const useMemoryNote = (id: string | undefined, o?: Opts<Awaited<ReturnType<typeof memory.note>>>) =>
  useQuery({ queryKey: qk.memoryNote(id ?? ""), queryFn: () => memory.note(id!), enabled: !!id, staleTime: 15_000, ...o });

export const useMemoryGraph = (o?: Opts<Awaited<ReturnType<typeof memory.graph>>>) =>
  useQuery({ queryKey: qk.memoryGraph, queryFn: memory.graph, staleTime: 15_000, ...o });

/** Debounce `q` at the call site (the server caches, but every distinct string is a CLI spawn). */
export const useMemorySearch = (q: string, o: { enabled?: boolean; types?: string[]; deep?: boolean; limit?: number } = {}) =>
  useQuery({
    queryKey: qk.memorySearch(q.trim(), o.types?.join(","), o.deep, o.limit),
    queryFn: () => memory.search(q.trim(), { types: o.types, deep: o.deep, limit: o.limit }),
    enabled: (o.enabled ?? true) && q.trim().length > 0,
    staleTime: 30_000,
  });

// ---------------------------------------------------------------------------------------------
// Weft reads
// ---------------------------------------------------------------------------------------------

export const useMeta = () => useQuery({ queryKey: qk.meta, queryFn: weft.meta, staleTime: 60_000 });
export const useWorkflows = () => useQuery({ queryKey: qk.workflows, queryFn: weft.workflows, staleTime: 60_000 });
export const useWorkflow = (name: string | undefined) =>
  useQuery({ queryKey: qk.workflow(name ?? ""), queryFn: () => weft.workflow(name!), enabled: !!name, staleTime: 60_000 });

export const useRuns = (f: { status?: RunStatus; workflow?: string; limit?: number } = {}) =>
  useQuery({ queryKey: qk.runs(f), queryFn: () => weft.runs({ ...f, spend: true }) });

export const useRun = (runId: string | undefined) =>
  useQuery({ queryKey: qk.run(runId ?? ""), queryFn: () => weft.run(runId!), enabled: !!runId });

export const useRunTree = (runId: string | undefined) =>
  useQuery({ queryKey: qk.runTree(runId ?? ""), queryFn: () => weft.tree(runId!), enabled: !!runId });

export const useRunPending = (runId: string | undefined) =>
  useQuery({ queryKey: qk.runPending(runId ?? ""), queryFn: () => weft.runPending(runId!), enabled: !!runId });

export const useRunArtifacts = (runId: string | undefined) =>
  useQuery({ queryKey: qk.runArtifacts(runId ?? ""), queryFn: () => weft.artifacts(runId!), enabled: !!runId });

export const useRunPatch = (runId: string | undefined, key?: string) =>
  useQuery({ queryKey: qk.runPatch(runId ?? "", key), queryFn: () => weft.patch(runId!, { key }), enabled: !!runId });

export const useRunReport = (runId: string | undefined) =>
  useQuery({ queryKey: qk.runReport(runId ?? ""), queryFn: () => weft.report(runId!), enabled: !!runId });

export const usePending = () => useQuery({ queryKey: qk.pending, queryFn: weft.pending });

/** Blob text (BRD/AAD versions, draft reports, diffs). Immutable, so cached forever. */
export const useBlobText = (ref: string | undefined) =>
  useQuery({ queryKey: qk.blob(ref ?? ""), queryFn: () => weft.blobText(ref!), enabled: !!ref, staleTime: Infinity, gcTime: 30 * 60_000 });

// ---------------------------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------------------------

function useInvalidateAll() {
  const qc = useQueryClient();
  return (projectId?: string) => {
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
    void qc.invalidateQueries({ queryKey: ["projects"] });
    void qc.invalidateQueries({ queryKey: ["inbox"] });
    void qc.invalidateQueries({ queryKey: ["activity"] });
    void qc.invalidateQueries({ queryKey: ["weft"] });
    if (projectId) void qc.invalidateQueries({ queryKey: ["project", projectId] });
    else void qc.invalidateQueries({ queryKey: ["project"] });
  };
}

const runCount = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** What approving each gate did, in words (the toast after the decision). */
const APPROVED_TEXT: Record<StageId, string> = {
  requirements: "Requirements approved; moved to Architecture",
  architecture: "Architecture approved; moved to Implementation",
  implementation: "Handed off to QA",
  qa: "Certified; sent to PO Review",
  signoff: "Signed off; project done",
};

function onErrorToast(e: Error) {
  toast.error(e.message);
}

/** Generic helper: a mutation that invalidates the project (and global lists) on success. */
function useProjectMutation<V, R>(projectId: string | undefined, fn: (vars: V) => Promise<R>, opts: { success?: string | ((r: R, v: V) => string) } = {}) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      invalidate(projectId);
      if (opts.success) toast.success(typeof opts.success === "function" ? opts.success(r, v) : opts.success);
    },
    onError: onErrorToast,
  });
}

export const useCreateProject = () => {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (body: CreateProjectBody) => delivery.createProject(body), onSuccess: () => invalidate(), onError: onErrorToast });
};

export const useDeleteProject = () => {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: string) => delivery.deleteProject(id), onSuccess: () => invalidate(), onError: onErrorToast });
};

export const useUpdateIntake = (projectId: string) =>
  useProjectMutation(projectId, (patch: Partial<Intake> & { name?: string; summary?: string }) => delivery.updateIntake(projectId, patch), { success: "Saved" });

export const useAddNote = (projectId: string) => useProjectMutation(projectId, (body: NoteBody) => delivery.addNote(projectId, body));
export const useDeleteNote = (projectId: string) => useProjectMutation(projectId, (noteId: string) => delivery.deleteNote(projectId, noteId));

export const useStartRequirements = (projectId: string) =>
  useProjectMutation(projectId, () => delivery.startRequirements(projectId), { success: "po-brd run started" });
export const useStartArchitecture = (projectId: string) =>
  useProjectMutation(projectId, (body: StartArchitectureBody) => delivery.startArchitecture(projectId, body), { success: "architect-aad run started" });
export const useStartPlan = (projectId: string) =>
  useProjectMutation(projectId, (body: StartPlanBody) => delivery.startPlan(projectId, body), { success: "dev-plan run started: generating the plan" });

export const useImportDoc = (projectId: string) =>
  useProjectMutation(projectId, (v: { stage: "requirements" | "architecture"; body: ImportBody }) => delivery.importDoc(projectId, v.stage, v.body), {
    success: (_r, v) => `${v.stage === "requirements" ? "BRD" : "AAD"} imported`,
  });

export const useStageDecision = (projectId: string) =>
  useProjectMutation(projectId, (v: { stage: StageId; body: DecisionBody }) => delivery.decideStage(projectId, v.stage, v.body), {
    success: (_r, v) => (v.body.decision === "approved" ? APPROVED_TEXT[v.stage] : "Change request recorded"),
  });

export const useReopenStage = (projectId: string) =>
  useProjectMutation(projectId, (v: { stage: StageId; body: ReopenBody }) => delivery.reopenStage(projectId, v.stage, v.body), { success: (_r, v) => `${stageDef(v.stage).title} reopened` });

export const useUpsertEpic = (projectId: string) =>
  useProjectMutation(projectId, (body: EpicUpsertBody) => delivery.upsertEpic(projectId, body), { success: (_r, body) => (body.id ? "Epic updated" : "Epic added") });
export const useDeleteEpic = (projectId: string) => useProjectMutation(projectId, (epicId: string) => delivery.deleteEpic(projectId, epicId), { success: "Epic deleted" });
export const useAcceptEpics = (projectId: string) =>
  useProjectMutation(projectId, (stage: "requirements" | "architecture") => delivery.acceptEpics(projectId, stage), { success: "Epics accepted" });
export const useSyncEpics = (projectId: string) => useProjectMutation(projectId, () => delivery.syncEpics(projectId), { success: "Epics created in Jira (mock)" });

export const useStartTasks = (projectId: string) =>
  useProjectMutation(projectId, (body: TaskStartBody) => delivery.startTasks(projectId, body), {
    // runIds is empty when the tasks were only queued behind dependencies or the agent limit.
    success: (r) => (r.runIds.length ? `${runCount(r.runIds.length, "agent run")} started` : "Tasks queued; they start when their dependencies are done and an agent is free"),
  });
export const usePatchTask = (projectId: string) =>
  useProjectMutation(projectId, (v: { taskId: string; body: TaskPatchBody }) => delivery.patchTask(projectId, v.taskId, v.body), { success: "Task updated" });
export const useRetryTask = (projectId: string) =>
  useProjectMutation(projectId, (taskId: string) => delivery.retryTask(projectId, taskId), { success: "dev-task run started" });

export const useStartQa = (projectId: string) =>
  useProjectMutation(projectId, (body: QaStartBody) => delivery.startQa(projectId, body), {
    success: (r) => (r.runIds.length ? `${runCount(r.runIds.length, "QA run")} started` : "No QA runs started; no task was eligible"),
  });
export const useWaiveTrace = (projectId: string) =>
  useProjectMutation(projectId, (v: { brRef: string; body: WaiveBody }) => delivery.waiveTrace(projectId, v.brRef, v.body), { success: "Requirement waived" });
export const useReviewChange = (projectId: string) =>
  useProjectMutation(projectId, (v: { changeId: string; body: ChangeReviewBody }) => delivery.reviewChange(projectId, v.changeId, v.body));

/**
 * Answer a weft human request. Errors ("request h3 is already answered", "… was superseded",
 * "answer does not match the request schema: …") come back as ApiError; the caller decides
 * whether to show them inline (pass onError) or let the default toast handle it.
 */
export const useAnswer = (projectId?: string) => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (v: { runId: string; body: AnswerBody }) => weft.answer(v.runId, v.body),
    onSuccess: () => invalidate(projectId),
  });
};

export const useCancelRun = (projectId?: string) => useProjectMutation(projectId, (runId: string) => weft.cancel(runId), { success: "Run cancelled" });
export const useResumeRun = (projectId?: string) => useProjectMutation(projectId, (runId: string) => weft.resume(runId), { success: "Run resumed" });

export const useUpdateSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => delivery.updateSettings(patch),
    onSuccess: (s) => qc.setQueryData(qk.settings, s),
    onError: onErrorToast,
  });
};

export const useResetDemo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => delivery.reset(),
    onSuccess: () => {
      void qc.invalidateQueries();
      toast.success("Demo data reset");
    },
    onError: onErrorToast,
  });
};

export const useFastForward = () => useMutation({ mutationFn: (runId?: string) => delivery.fastForward(runId), onError: onErrorToast });

/** Rebuild the memory vault's derived search index (the page's only write). */
export const useRebuildMemoryIndex = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => memory.rebuildIndex(),
    onSuccess: (stats) => {
      void qc.invalidateQueries({ queryKey: ["memory"] });
      toast.success(`Memory index rebuilt: ${stats.totals.notes} notes, ${stats.totals.claims} claims`);
    },
    onError: onErrorToast,
  });
};

/** Asks whether the configured weft daemon answers (a mutation: it runs on demand, never cached). */
export const useDaemonProbe = () => useMutation({ mutationFn: () => delivery.daemonProbe() });
