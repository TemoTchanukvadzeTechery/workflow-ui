import "server-only";
/**
 * `GET /api/runs/:id/tree`: port of weft's renderTree. Steps nest under their parentSeq, group
 * by phase in phase order, and anything outside a phase lands in "(no phase)". Human requests
 * are not steps, so they never appear here.
 */
import type { RunState, TreeNode, TreePhase } from "@/lib/weft/types";

export function renderTree(state: RunState): TreePhase[] {
  // Duplicate seqs (a resumed weft run's second pass) display their LATEST occurrence.
  const nodesBySeq = new Map<number, TreeNode>();
  for (const step of state.steps) {
    nodesBySeq.set(step.seq, {
      seq: step.seq,
      kind: step.kind,
      label: step.label ?? step.key ?? `${step.kind}#${step.seq}`,
      status: step.status,
      ...(step.usage !== undefined ? { usage: step.usage } : {}),
      children: [],
    });
  }
  const roots: number[] = [];
  for (const node of nodesBySeq.values()) {
    const step = state.steps.findLast((s) => s.seq === node.seq)!;
    if (step.parentSeq !== undefined && nodesBySeq.has(step.parentSeq) && step.parentSeq !== step.seq) {
      nodesBySeq.get(step.parentSeq)!.children.push(node);
    } else {
      roots.push(step.seq);
    }
  }
  const rootSet = new Set(roots);
  const phases: TreePhase[] = state.phases.map((p) => ({
    name: p.name,
    nodes: p.steps.filter((s) => rootSet.has(s)).map((s) => nodesBySeq.get(s)!),
  }));
  const inPhase = new Set(state.phases.flatMap((p) => p.steps));
  const orphans = roots.filter((s) => !inPhase.has(s));
  if (orphans.length > 0) phases.push({ name: "(no phase)", nodes: orphans.map((s) => nodesBySeq.get(s)!) });
  return phases;
}
