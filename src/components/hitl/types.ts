/**
 * One shape for a human request whether it came from a pending list (PendingRequest: no key or
 * phase) or from a run's projection (HumanState: key, phase, status, answer). Forms take this.
 */
import type {
  AnsweredBy,
  BlobRef,
  HumanKind,
  HumanState,
  HumanStatus,
  JsonSchema,
  PendingRequest,
  ReviewAttachment,
  ReviewEdit,
  ReviewSubject,
  Risk,
  RunDetail,
  UiPresentation,
} from "@/lib/weft/types";

export interface RequestView {
  runId: string;
  id: string;
  key?: string;
  phase?: string;
  kind: HumanKind;
  question: string;
  detail?: string;
  schema: JsonSchema;
  risk?: Risk;
  createdAt: number;
  deadline?: number;
  confirmToken?: string;
  artifactRef?: BlobRef;
  reviewSubject?: ReviewSubject;
  reviewAttachments?: ReviewAttachment[];
  ui?: UiPresentation;
  status: HumanStatus;
  answer?: unknown;
  answeredBy?: AnsweredBy;
  reviewEdit?: ReviewEdit;
  workflow?: string;
}

export interface RequestFormProps {
  request: RequestView;
  /** The run the request belongs to, when loaded (input.maxRounds etc.). */
  run?: RunDetail;
  projectId?: string;
  compact?: boolean;
  onAnswered?: () => void;
}

function isHumanState(r: PendingRequest | HumanState): r is HumanState {
  return "requestedAt" in r && "status" in r;
}

/** Normalize a PendingRequest or HumanState, joining key/phase/status from the run when known. */
export function toRequestView(runId: string, request: PendingRequest | HumanState, run?: RunDetail, workflow?: string): RequestView {
  const joined = run?.humans.find((h) => h.id === request.id);
  const base = isHumanState(request) ? request : undefined;
  const pending = isHumanState(request) ? undefined : request;
  const key = base?.key ?? joined?.key;
  const phase = base?.phase ?? joined?.phase;
  const status: HumanStatus = base?.status ?? joined?.status ?? "pending";
  const answer = base?.answer ?? joined?.answer;
  const answeredBy = base?.answeredBy ?? joined?.answeredBy;
  const reviewEdit = base?.reviewEdit ?? joined?.reviewEdit;
  const wf = workflow ?? run?.workflow;
  return {
    runId,
    id: request.id,
    kind: request.kind,
    question: request.question,
    schema: request.schema,
    createdAt: base?.requestedAt ?? pending?.createdAt ?? Date.now(),
    status,
    ...(key !== undefined ? { key } : {}),
    ...(phase !== undefined ? { phase } : {}),
    ...(request.detail != null ? { detail: request.detail } : {}),
    ...(request.risk ? { risk: request.risk } : {}),
    ...(request.deadline !== undefined ? { deadline: request.deadline } : {}),
    ...(request.confirmToken ? { confirmToken: request.confirmToken } : {}),
    ...(request.artifactRef ? { artifactRef: request.artifactRef } : {}),
    ...(request.reviewSubject ? { reviewSubject: request.reviewSubject } : {}),
    ...(request.reviewAttachments ? { reviewAttachments: request.reviewAttachments } : {}),
    ...(request.ui ? { ui: request.ui } : {}),
    ...(answer !== undefined ? { answer } : {}),
    ...(answeredBy ? { answeredBy } : {}),
    ...(reviewEdit ? { reviewEdit } : {}),
    ...(wf ? { workflow: wf } : {}),
  };
}

/** An attachment by label, case-insensitive ("draft report", "tasks", "diff", …). */
export function findAttachment(request: Pick<RequestView, "reviewAttachments">, label: string): ReviewAttachment | undefined {
  const want = label.toLowerCase();
  return request.reviewAttachments?.find((a) => (a.label ?? "").toLowerCase() === want);
}

/** The file subject of a review, if it is one. */
export function fileSubject(request: Pick<RequestView, "reviewSubject">): Extract<ReviewSubject, { kind: "file" }> | undefined {
  return request.reviewSubject?.kind === "file" ? request.reviewSubject : undefined;
}

export function artifactSubject(request: Pick<RequestView, "reviewSubject">): Extract<ReviewSubject, { kind: "artifact" }> | undefined {
  return request.reviewSubject?.kind === "artifact" ? request.reviewSubject : undefined;
}
