/**
 * Pure helpers that turn a RunDetail into the phase-grouped ledger the run inspector shows.
 * Steps and human requests share one seq space (weft journals both), so a request appears at
 * its position between the steps around it. Policy gates are hidden unless asked for.
 */
import { formatDuration, formatTokens, formatUsd } from "@/lib/format";
import type { Tone } from "@/lib/weft/labels";
import type { HumanState, RunDetail, RunState, StepState } from "@/lib/weft/types";

export type LedgerEntry =
  | { type: "step"; seq: number; phase: string; depth: number; step: StepState }
  | { type: "human"; seq: number; phase: string; depth: number; human: HumanState };

export interface LedgerGroup {
  /** Position-based key: phase names repeat across a run ("Draft 1", "Draft 2" do not, but "Discover" may). */
  key: string;
  name: string;
  entries: LedgerEntry[];
  steps: number;
  tokens: number;
  usd: number;
  running: number;
  failed: number;
  /** Failed steps that a later step with the same label in this phase passed (a check retried after a fix). */
  recovered: number;
  waiting: number;
  /** Policy gates in this phase that are currently hidden. */
  hiddenGates: number;
}

export const NO_PHASE = "(no phase)";

/** weft auto-approves tool gates by policy; they never reach a person. */
export function isPolicyGate(h: HumanState): boolean {
  return h.kind === "gate" && h.answeredBy === "policy";
}

export function policyGates(run: Pick<RunState, "humans">): HumanState[] {
  return run.humans.filter(isPolicyGate);
}

/** Pending requests a person must answer (policy gates excluded), oldest first. */
export function pendingHumans(run: Pick<RunState, "humans">): HumanState[] {
  return run.humans.filter((h) => h.status === "pending" && h.kind !== "gate").sort((a, b) => a.seq - b.seq);
}

export function stepTokens(s: StepState): number {
  return s.usage ? (s.usage.input ?? 0) + (s.usage.output ?? 0) : 0;
}

/** Every ledger entry in seq order, with its phase carried forward when the event had none. */
export function ledgerEntries(run: Pick<RunState, "steps" | "humans">, opts: { showGates?: boolean } = {}): LedgerEntry[] {
  const bySeq = new Map<number, StepState>();
  for (const s of run.steps) bySeq.set(s.seq, s);
  const raw: Array<{ seq: number; step?: StepState; human?: HumanState }> = [
    ...run.steps.map((step): { seq: number; step?: StepState; human?: HumanState } => ({ seq: step.seq, step })),
    ...run.humans.map((human): { seq: number; step?: StepState; human?: HumanState } => ({ seq: human.seq, human })),
  ].sort((a, b) => a.seq - b.seq || (a.step ? -1 : 1));

  const out: LedgerEntry[] = [];
  let lastPhase: string | undefined;
  for (const r of raw) {
    const phase = (r.step ? r.step.phase : r.human?.phase) ?? lastPhase ?? NO_PHASE;
    lastPhase = phase;
    if (r.human) {
      if (!opts.showGates && isPolicyGate(r.human)) continue;
      out.push({ type: "human", seq: r.seq, phase, depth: 0, human: r.human });
    } else if (r.step) {
      let depth = 0;
      let parent = r.step.parentSeq;
      while (parent !== undefined && depth < 4) {
        depth++;
        parent = bySeq.get(parent)?.parentSeq;
      }
      out.push({ type: "step", seq: r.seq, phase, depth, step: r.step });
    }
  }
  return out;
}

/** Consecutive entries of one phase form a group, in run order. */
export function buildLedger(run: Pick<RunState, "steps" | "humans">, opts: { showGates?: boolean } = {}): LedgerGroup[] {
  const groups: LedgerGroup[] = [];
  const hidden = opts.showGates ? [] : policyGates(run);
  // Assign each hidden gate to the phase it sits in (for the per-group count).
  const all = ledgerEntries(run, { showGates: true });
  const phaseOfSeq = new Map(all.map((e) => [e.seq, e.phase]));

  for (const e of ledgerEntries(run, opts)) {
    let g = groups[groups.length - 1];
    if (!g || g.name !== e.phase) {
      g = { key: `${groups.length}:${e.phase}`, name: e.phase, entries: [], steps: 0, tokens: 0, usd: 0, running: 0, failed: 0, recovered: 0, waiting: 0, hiddenGates: 0 };
      groups.push(g);
    }
    g.entries.push(e);
    if (e.type === "step") {
      g.steps++;
      g.tokens += stepTokens(e.step);
      g.usd += e.step.usage?.usd ?? 0;
      if (e.step.status === "running") g.running++;
      if (e.step.status === "failed") g.failed++;
    } else if (e.human.status === "pending" && e.human.kind !== "gate") {
      g.waiting++;
    }
  }
  for (const g of groups) {
    const steps = g.entries.flatMap((e) => (e.type === "step" ? [e.step] : []));
    g.recovered = steps.filter((st, i) => st.status === "failed" && steps.slice(i + 1).some((later) => later.status === "ok" && (later.label ?? later.key) === (st.label ?? st.key))).length;
  }
  for (const h of hidden) {
    const phase = phaseOfSeq.get(h.seq);
    // The first group of that phase positioned before the gate's seq.
    const g = [...groups].reverse().find((x) => x.name === phase && x.entries[0] && x.entries[0].seq <= h.seq) ?? groups.find((x) => x.name === phase);
    if (g) g.hiddenGates++;
  }
  return groups;
}

/**
 * The entry a run page should open on: the oldest pending request, else a running step. A failed
 * run opens on its last failed step. Any other run (complete, cancelled, or between steps) opens
 * on its last person-answered request (the final review or accept), else its last agent step,
 * else its last entry: a check that failed once and then passed after a fix is history, not the
 * headline.
 */
export function defaultSeq(run: Pick<RunState, "steps" | "humans" | "status">): number | undefined {
  const pending = pendingHumans(run)[0];
  if (pending) return pending.seq;
  const running = [...run.steps].reverse().find((s) => s.status === "running");
  if (running) return running.seq;
  if (run.status === "failed") {
    const failed = [...run.steps].reverse().find((s) => s.status === "failed");
    if (failed) return failed.seq;
  }
  const answered = [...run.humans].sort((a, b) => b.seq - a.seq).find((h) => h.kind !== "gate" && h.status === "answered");
  if (answered) return answered.seq;
  const agent = [...run.steps].sort((a, b) => b.seq - a.seq).find((s) => s.kind === "agent" && s.status === "ok");
  if (agent) return agent.seq;
  const all = ledgerEntries(run);
  return all[all.length - 1]?.seq;
}

export function findEntry(run: Pick<RunState, "steps" | "humans">, seq: number): LedgerEntry | undefined {
  return ledgerEntries(run, { showGates: true }).find((e) => e.seq === seq);
}

export function entryTitle(e: LedgerEntry): string {
  if (e.type === "step") return e.step.key ?? e.step.label ?? `${e.step.kind} ${e.seq}`;
  return e.human.key ?? `${e.human.kind === "gate" ? "gate" : "human"} ${e.human.id}`;
}

export function entryKind(e: LedgerEntry): string {
  if (e.type === "step") return e.step.kind === "sideeffect" ? "effect" : e.step.kind;
  return e.human.kind === "gate" ? "gate" : "human";
}

export interface EntryState {
  tone: Tone;
  pulse: boolean;
  label: string;
}

export function entryState(e: LedgerEntry): EntryState {
  if (e.type === "step") {
    if (e.step.status === "running") return { tone: "running", pulse: true, label: "Running" };
    if (e.step.status === "failed") return { tone: "danger", pulse: false, label: "Failed" };
    return { tone: "success", pulse: false, label: "Done" };
  }
  const h = e.human;
  if (h.status === "pending") return h.kind === "gate" ? { tone: "attention", pulse: false, label: "Gate waiting" } : { tone: "attention", pulse: false, label: "Needs your input" };
  if (h.status === "superseded") return { tone: "neutral", pulse: false, label: "Superseded" };
  if (h.answeredBy === "policy") return { tone: "neutral", pulse: false, label: "Auto-approved" };
  if (h.answeredBy === "timeout") return { tone: "neutral", pulse: false, label: "Timed out" };
  return { tone: "success", pulse: false, label: "Answered" };
}

export function stepDurationMs(s: StepState): number | undefined {
  return s.endedAt !== undefined ? Math.max(0, s.endedAt - s.startedAt) : undefined;
}

/** Static meta text for a finished row: "4.4k tok · $0.86" for agents, else "00:02". */
export function staticMeta(s: StepState): string {
  const tok = stepTokens(s);
  if (tok > 0) return `${formatTokens(tok, { compact: true })}${s.usage?.usd ? ` · ${formatUsd(s.usage.usd)}` : ""}`;
  return formatDuration(stepDurationMs(s) ?? 0, "clock");
}

/** Wall time of a run: until updatedAt when terminal, else live. */
export function runElapsedEnd(run: Pick<RunDetail, "status" | "updatedAt">, terminal: boolean): number | undefined {
  return terminal ? run.updatedAt : undefined;
}
