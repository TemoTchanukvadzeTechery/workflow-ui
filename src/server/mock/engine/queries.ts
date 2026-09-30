import "server-only";
/**
 * Read models over a run's journal, shaped exactly like the weft daemon's responses:
 * runs list rows, pending requests (daemon state.ts pendingOf), artifact inventory and the
 * patch view (daemon api/artifacts.ts).
 */
import type {
  ArtifactEntry,
  HumanState,
  JournalRecord,
  PatchResponse,
  PendingRequest,
  RunRow,
  RunState,
} from "@/lib/weft/types";
import type { BlobStore } from "./blobs";
import { apiError } from "./errors";
import type { RunEntry } from "./internal";
import { parseDiffStats } from "./patches";

export function runRow(run: RunEntry, state: RunState | undefined): RunRow {
  const first = run.records[0];
  const last = run.records[run.records.length - 1];
  const row: RunRow = {
    runId: run.runId,
    workflow: run.workflow.id,
    status: run.status,
    createdAt: first?.at ?? 0,
    updatedAt: last?.at ?? 0,
  };
  if (state) {
    // Distinct seqs, not array length, as the daemon counts them.
    const latest = new Map(state.steps.map((step) => [step.seq, step]));
    row.spend = { ...state.budget };
    row.steps = latest.size;
    row.running = [...latest.values()].filter((step) => step.status === "running").length;
  }
  return row;
}

export function pendingRequestOf(runId: string, human: HumanState): PendingRequest {
  return {
    runId,
    id: human.id,
    kind: human.kind,
    question: human.question,
    schema: human.schema,
    createdAt: human.requestedAt,
    ...(human.detail !== undefined ? { detail: human.detail } : {}),
    ...(human.risk !== undefined ? { risk: human.risk } : {}),
    ...(human.deadline !== undefined ? { deadline: human.deadline } : {}),
    ...(human.confirmToken !== undefined ? { confirmToken: human.confirmToken } : {}),
    ...(human.artifactRef !== undefined ? { artifactRef: human.artifactRef } : {}),
    ...(human.reviewSubject !== undefined ? { reviewSubject: human.reviewSubject } : {}),
    ...(human.reviewAttachments !== undefined ? { reviewAttachments: human.reviewAttachments } : {}),
  };
}

/** Pending requests a person can answer (policy gates never wait, and never show). */
export function pendingOf(state: RunState): PendingRequest[] {
  return state.humans.filter((h) => h.status === "pending" && h.kind !== "gate").map((h) => pendingRequestOf(state.runId, h));
}

export function artifactsOf(state: RunState, records: readonly JournalRecord[], blobs: BlobStore): ArtifactEntry[] {
  const out = new Map<string, ArtifactEntry>();
  const capturedSeq = new Map<string, number>();
  for (const { ev } of records) if (ev.type === "patch.captured") capturedSeq.set(`${ev.key}\u0000${ev.ref}`, ev.seq);

  for (const patch of state.patches.captured) {
    // weft links a patch to its step through step.patchRef; the mock's ctx.patch names the seq.
    const seq = capturedSeq.get(`${patch.key}\u0000${patch.ref}`);
    const step = state.steps.find((s) => s.patchRef === patch.ref) ?? (seq !== undefined ? state.steps.findLast((s) => s.seq === seq) : undefined);
    out.set(`patch:${patch.key}`, {
      ref: patch.ref,
      id: patch.key,
      kind: "patch",
      size: null,
      producedBy: step ? { seq: step.seq, kind: step.kind, label: step.label ?? step.key ?? `${step.kind}#${step.seq}` } : null,
      at: step?.endedAt ?? step?.startedAt ?? null,
      key: patch.key,
      files: patch.files,
      available: blobs.has(patch.ref),
    });
  }

  // weft lists only a request's legacy artifactRef; the mock also lists review subjects,
  // attachments and reviewer edits so the run inspector's Artifacts tab has the documents.
  const seenRefs = new Set<string>();
  for (const human of state.humans) {
    const gate = { id: human.id, kind: human.kind, question: human.question };
    const add = (id: string, ref: { $blob: string; size: number; preview?: string }, files?: string[]) => {
      if (seenRefs.has(ref.$blob)) return;
      seenRefs.add(ref.$blob);
      out.set(`human:${id}`, {
        ref: ref.$blob,
        id,
        kind: "artifact",
        size: ref.size,
        producedBy: null,
        at: human.requestedAt,
        ...(files ? { files } : {}),
        ...(ref.preview !== undefined ? { preview: ref.preview } : {}),
        gate,
        available: blobs.has(ref.$blob),
      });
    };
    if (human.artifactRef) add(human.id, human.artifactRef);
    const subject = human.reviewSubject;
    if (subject) add(human.id, subject.ref, subject.kind === "file" ? [subject.path] : undefined);
    human.reviewAttachments?.forEach((a, i) => add(`${human.id}:${i + 1}`, a.ref));
    if (human.reviewEdit) add(`${human.id}:edit`, human.reviewEdit.ref, [human.reviewEdit.path]);
  }
  return [...out.values()];
}

export function patchOf(state: RunState, blobs: BlobStore, opts: { key?: string; statsOnly?: boolean } = {}): PatchResponse {
  const { key } = opts;
  const wanted = key === undefined ? state.patches.captured : state.patches.captured.filter((p) => p.key === key);
  if (key !== undefined && wanted.length === 0) throw apiError(`patch ${key} not found in run ${state.runId}`);
  return {
    runId: state.runId,
    patches: wanted.map((patch) => {
      const diff = blobs.get(patch.ref);
      return {
        key: patch.key,
        ref: patch.ref,
        files: patch.files,
        outOfScope: patch.outOfScope ?? [],
        merged: state.patches.merged.some((m) => m.key === patch.key),
        discarded: state.patches.discarded.some((d) => d.key === patch.key),
        available: diff !== undefined,
        stats: diff === undefined ? [] : parseDiffStats(diff),
        ...(opts.statsOnly || diff === undefined ? {} : { diff }),
      };
    }),
  };
}
