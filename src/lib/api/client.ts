/**
 * Thin fetch wrappers. The browser only ever talks to this Next.js app:
 *   /api/weft/*      weft-daemon-compatible (mock in-process, or proxied to 127.0.0.1:4781)
 *   /api/delivery/*  the project/stage layer weft does not have
 *   /api/events      SSE change stream (see live.ts)
 * Every request carries the "Acting as" name in `x-actor` so decisions can be attributed.
 */
import type {
  Activity,
  ChangeReview,
  ChangeReviewBody,
  CreateProjectBody,
  DashboardData,
  DecisionBody,
  DeliveryTask,
  DocumentArtifact,
  DocVersion,
  Epic,
  EpicUpsertBody,
  ImportBody,
  InboxItem,
  Intake,
  NoteBody,
  ProjectBundle,
  ProjectSummary,
  QaStartBody,
  ReopenBody,
  Settings,
  StageId,
  StageNote,
  StartArchitectureBody,
  StartPlanBody,
  TaskPatchBody,
  TaskStartBody,
  TraceRow,
  WaiveBody,
} from "@/lib/delivery/types";
import type {
  AnswerBody,
  ArtifactEntry,
  Meta,
  PatchResponse,
  PendingRequest,
  PendingResponse,
  RunDetail,
  RunRow,
  RunStatus,
  StartRunBody,
  TreePhase,
  WorkflowDetail,
  WorkflowRow,
} from "@/lib/weft/types";
import { getActorName } from "./actor";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

async function request<T>(method: Method, url: string, body?: unknown, accept = "application/json"): Promise<T> {
  // URI-encoded so names outside Latin-1 survive the header; the server decodes it.
  const headers: Record<string, string> = { accept, "x-actor": encodeURIComponent(getActorName()) };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, message);
  }
  if (accept !== "application/json") return (await res.text()) as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    sp.set(k, v === true ? "1" : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

const enc = encodeURIComponent;

// ---------------------------------------------------------------------------------------------
// /api/weft: same paths and shapes as the weft daemon's /api
// ---------------------------------------------------------------------------------------------

export const weft = {
  meta: () => request<Meta>("GET", "/api/weft/meta"),
  workflows: () => request<WorkflowRow[]>("GET", "/api/weft/workflows"),
  workflow: (name: string) => request<WorkflowDetail>("GET", `/api/weft/workflows/${enc(name)}`),
  runs: (f: { status?: RunStatus; workflow?: string; limit?: number; spend?: boolean } = {}) =>
    request<RunRow[]>("GET", `/api/weft/runs${qs({ status: f.status, workflow: f.workflow, limit: f.limit, spend: f.spend ?? true })}`),
  start: (body: StartRunBody) => request<{ ok: true; runId: string; workflow: string }>("POST", "/api/weft/runs", body),
  run: (runId: string) => request<RunDetail>("GET", `/api/weft/runs/${enc(runId)}?detail=1`),
  tree: (runId: string) => request<TreePhase[]>("GET", `/api/weft/runs/${enc(runId)}/tree`),
  report: (runId: string) => request<string>("GET", `/api/weft/runs/${enc(runId)}/report`, undefined, "text/markdown"),
  runPending: (runId: string) => request<PendingRequest[]>("GET", `/api/weft/runs/${enc(runId)}/pending`),
  pending: () => request<PendingResponse>("GET", "/api/weft/pending"),
  answer: (runId: string, body: AnswerBody) => request<{ ok: true; woke: boolean }>("POST", `/api/weft/runs/${enc(runId)}/answer`, body),
  cancel: (runId: string) => request<{ ok: true }>("POST", `/api/weft/runs/${enc(runId)}/cancel`, {}),
  resume: (runId: string) => request<{ ok: true; runId: string }>("POST", `/api/weft/runs/${enc(runId)}/resume`, {}),
  artifacts: (runId: string) => request<ArtifactEntry[]>("GET", `/api/weft/runs/${enc(runId)}/artifacts`),
  patch: (runId: string, o: { key?: string; statsOnly?: boolean } = {}) =>
    request<PatchResponse>("GET", `/api/weft/runs/${enc(runId)}/patch${qs({ key: o.key, stats: o.statsOnly })}`),
  blobText: (ref: string) => request<string>("GET", `/api/weft/blobs/${enc(ref)}?as=text`, undefined, "text/plain"),
};

// ---------------------------------------------------------------------------------------------
// /api/delivery: projects, stages, epics, tasks, QA, inbox, settings
// ---------------------------------------------------------------------------------------------

const P = (id: string) => `/api/delivery/projects/${enc(id)}`;

export const delivery = {
  dashboard: () => request<DashboardData>("GET", "/api/delivery/dashboard"),
  projects: () => request<ProjectSummary[]>("GET", "/api/delivery/projects"),
  project: (id: string) => request<ProjectBundle>("GET", P(id)),
  createProject: (body: CreateProjectBody) => request<ProjectBundle>("POST", "/api/delivery/projects", body),
  deleteProject: (id: string) => request<{ ok: true }>("DELETE", P(id)),
  updateIntake: (id: string, patch: Partial<Intake> & { name?: string; summary?: string }) =>
    request<ProjectBundle>("PATCH", `${P(id)}/intake`, patch),

  addNote: (id: string, body: NoteBody) => request<StageNote>("POST", `${P(id)}/notes`, body),
  deleteNote: (id: string, noteId: string) => request<{ ok: true }>("DELETE", `${P(id)}/notes/${enc(noteId)}`),

  startRequirements: (id: string) => request<{ runId: string }>("POST", `${P(id)}/stages/requirements/start`, {}),
  startArchitecture: (id: string, body: StartArchitectureBody) => request<{ runId: string }>("POST", `${P(id)}/stages/architecture/start`, body),
  startPlan: (id: string, body: StartPlanBody = {}) => request<{ runId: string }>("POST", `${P(id)}/stages/implementation/start`, body),
  importDoc: (id: string, stage: "requirements" | "architecture", body: ImportBody) =>
    request<ProjectBundle>("POST", `${P(id)}/stages/${stage}/import`, body),
  decideStage: (id: string, stage: StageId, body: DecisionBody) => request<ProjectBundle>("POST", `${P(id)}/stages/${stage}/decision`, body),
  reopenStage: (id: string, stage: StageId, body: ReopenBody) => request<ProjectBundle>("POST", `${P(id)}/stages/${stage}/reopen`, body),

  upsertEpic: (id: string, body: EpicUpsertBody) => request<Epic>("POST", `${P(id)}/epics`, body),
  deleteEpic: (id: string, epicId: string) => request<{ ok: true }>("DELETE", `${P(id)}/epics/${enc(epicId)}`),
  acceptEpics: (id: string, stage: "requirements" | "architecture") => request<ProjectBundle>("POST", `${P(id)}/epics/accept`, { stage }),
  syncEpics: (id: string) => request<ProjectBundle>("POST", `${P(id)}/epics/sync`, {}),

  startTasks: (id: string, body: TaskStartBody) => request<{ runIds: string[] }>("POST", `${P(id)}/tasks/start`, body),
  patchTask: (id: string, taskId: string, body: TaskPatchBody) => request<DeliveryTask>("PATCH", `${P(id)}/tasks/${enc(taskId)}`, body),
  retryTask: (id: string, taskId: string) => request<{ runId: string }>("POST", `${P(id)}/tasks/${enc(taskId)}/retry`, {}),

  startQa: (id: string, body: QaStartBody = {}) => request<{ runIds: string[] }>("POST", `${P(id)}/qa/start`, body),
  waiveTrace: (id: string, brRef: string, body: WaiveBody) => request<TraceRow>("POST", `${P(id)}/trace/${enc(brRef)}/waive`, body),
  reviewChange: (id: string, changeId: string, body: ChangeReviewBody) =>
    request<ChangeReview>("POST", `${P(id)}/changes/${enc(changeId)}/review`, body),

  doc: (id: string, docId: string, v?: number) =>
    request<{ doc: DocumentArtifact; text: string; version: DocVersion }>("GET", `${P(id)}/docs/${enc(docId)}${qs({ v })}`),

  inbox: () => request<InboxItem[]>("GET", "/api/delivery/inbox"),
  activity: (f: { projectId?: string; limit?: number } = {}) => request<Activity[]>("GET", `/api/delivery/activity${qs(f)}`),
  workspaceFiles: (prefix = "notes/") =>
    request<Array<{ path: string; size: number; updatedAt: number }>>("GET", `/api/delivery/workspace/files${qs({ prefix })}`),

  settings: () => request<Settings>("GET", "/api/delivery/settings"),
  updateSettings: (patch: Partial<Settings>) => request<Settings>("PATCH", "/api/delivery/settings", patch),
  reset: () => request<{ ok: true }>("POST", "/api/delivery/admin/reset", {}),
  fastForward: (runId?: string) => request<{ ok: true }>("POST", "/api/delivery/admin/fast-forward", { runId }),
  /** Whether the daemon at settings.weftDaemon answers, before switching the data source to it. */
  daemonProbe: () => request<{ ok: boolean; url: string; version?: string; error?: string }>("GET", "/api/delivery/daemon-probe"),
};
