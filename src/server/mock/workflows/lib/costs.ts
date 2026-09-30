import "server-only";
/**
 * Spend and pacing per agent step, taken from the real runs (brief B.5): po-brd 0035d37f cost
 * $3.43 / 21,110 tok for one round, architect-aad f442e3a3 $6.92 / 46,099 tok. Durations are the
 * "fast" speed base; the engine scales them (instant ×0, realistic ×5).
 */

export interface AgentCost {
  usd: number;
  tokens: number;
}

export interface DocCosts {
  /** Planner rounds discover:1..3 of the first pass; later rounds reuse the last entry. */
  discover: AgentCost[];
  draft: AgentCost;
  /** Revision rounds (draft:2 and later) re-read the current file and change only some sections. */
  revise: AgentCost;
  memory: AgentCost;
}

export const COSTS: Record<"BRD" | "AAD", DocCosts> = {
  BRD: {
    discover: [
      { usd: 0.859605, tokens: 4418 },
      { usd: 0.6145705, tokens: 3894 },
      { usd: 0.604454, tokens: 3626 },
    ],
    draft: { usd: 0.824997, tokens: 7159 },
    revise: { usd: 0.713, tokens: 6120 },
    memory: { usd: 0.5228245, tokens: 2013 },
  },
  AAD: {
    discover: [
      { usd: 1.1416375, tokens: 9103 },
      { usd: 0.9542305, tokens: 8511 },
      { usd: 1.0230735, tokens: 8820 },
    ],
    draft: { usd: 2.811057, tokens: 14120 },
    revise: { usd: 2.264, tokens: 12480 },
    memory: { usd: 0.9899165, tokens: 5545 },
  },
};

/** Base durations in ms at "fast" speed. */
export const PACE = {
  preflight: 1000,
  memory: 1000,
  atl: 300,
  discover: 3000,
  draft: 6000,
  integrate: 1000,
  memoryPropose: 3000,
} as const;

export function discoverCost(doc: "BRD" | "AAD", round: number): AgentCost {
  const list = COSTS[doc].discover;
  return list[Math.min(round, list.length) - 1] ?? list[list.length - 1]!;
}
