import "server-only";
/**
 * Requirement traceability (the QA matrix): one row per BRD requirement, joined to AAD FRs,
 * epics, tasks, acceptance criteria and QA evidence, with a Rovo-style verdict.
 */
import type { Evidence, TraceRow } from "@/lib/delivery/types";
import type { ProjectData, StoredDoc } from "./state";

export function acceptedDoc(pd: ProjectData, kind: "brd" | "aad"): StoredDoc | undefined {
  const id = kind === "brd" ? pd.project.stages.requirements.brdDocId : pd.project.stages.architecture.aadDocId;
  return pd.documents.find((d) => d.id === id);
}

function combine(results: Array<Evidence["result"]>): "pass" | "fail" | "none" {
  if (results.includes("fail")) return "fail";
  if (results.includes("pass")) return "pass";
  return "none";
}

export function buildTrace(pd: ProjectData): TraceRow[] {
  const brd = acceptedDoc(pd, "brd");
  const aad = acceptedDoc(pd, "aad");
  const requirements = brd?.requirements ?? [];
  const frs = aad?.frs ?? [];
  const liveEvidence = pd.evidence.filter((e) => !e.supersededBy);
  return requirements.map((br) => {
    const frRefs = frs.filter((fr) => fr.traces.includes(br.id)).map((fr) => fr.id);
    const epicIds = pd.epics.filter((e) => e.brdRequirementRefs.includes(br.id)).map((e) => e.id);
    const tasks = pd.tasks.filter((t) => t.status !== "cancelled" && t.traces.some((ref) => ref === br.id || frRefs.includes(ref)));
    const taskIds = tasks.map((t) => t.id);
    const acIds = tasks.flatMap((t) => t.acceptanceCriteria.map((ac) => `${t.id}/${ac.id}`));
    const evidence = liveEvidence.filter((e) => taskIds.includes(e.taskId));
    const automated = combine(evidence.filter((e) => e.mode === "automated").map((e) => e.result));
    const manual = combine(evidence.filter((e) => e.mode === "manual").map((e) => e.result));
    const waiver = pd.waivers[br.id];
    let verdict: TraceRow["verdict"];
    if (waiver) verdict = "waived";
    else if (!tasks.length || !evidence.length) verdict = "missing";
    else if (tasks.some((t) => t.qa.status === "bugs_found") || evidence.some((e) => e.result === "fail" && !certified(pd, e.taskId))) verdict = "missing";
    else if (tasks.every((t) => t.qa.status === "certified")) verdict = "met";
    else verdict = "needs_manual_check";
    const row: TraceRow = {
      brRef: br.id,
      brText: br.candidate ? `(Candidate) ${br.text}` : br.text,
      frRefs,
      epicIds,
      taskIds,
      acIds,
      automated,
      manual,
      evidenceCount: evidence.length,
      verdict,
    };
    if (waiver) row.waiver = waiver;
    return row;
  });
}

function certified(pd: ProjectData, taskId: string): boolean {
  return pd.tasks.find((t) => t.id === taskId)?.qa.status === "certified";
}
