import "server-only";
/**
 * Budget strings and step usage. parseBudget/budgetOf are ports of weft's host budget grammar
 * ("500k", "$5", "500k,$5") with the daemon's error texts; usageFor invents a token split that
 * looks like a real Claude step (tiny uncached input, output-dominated, large cacheRead).
 */
import type { Usage } from "@/lib/weft/types";

export interface BudgetLimits {
  tokens?: number;
  usd?: number;
}

const SCALES: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };
const PART = /^(\$)?(\d+(?:\.\d+)?)([kmb])?$/i;
const SHAPE = 'expected a token count ("500k", "2m", "120000") or a dollar amount ("$5", "$0.50")';

export function parseBudget(text: string): BudgetLimits {
  const parts = text.split(/[,\s]+/).filter((p) => p !== "");
  if (parts.length === 0) throw invalid(text);
  const out: BudgetLimits = {};
  for (const part of parts) {
    const match = PART.exec(part);
    if (!match) throw invalid(text);
    const scale = match[3] ? (SCALES[match[3].toLowerCase()] ?? 1) : 1;
    const value = Number(match[2]) * scale;
    if (!Number.isFinite(value)) throw invalid(text);
    if (match[1]) {
      if (out.usd !== undefined) throw new Error(`invalid budget ${JSON.stringify(text)}: $ given twice`);
      out.usd = Math.round(value * 100) / 100;
    } else {
      if (out.tokens !== undefined) throw new Error(`invalid budget ${JSON.stringify(text)}: token count given twice`);
      out.tokens = Math.round(value);
    }
  }
  return out;
}

function invalid(text: string): Error {
  return new Error(`invalid budget ${JSON.stringify(text)}: ${SHAPE}`);
}

/** POST /api/runs `budget` field, validated exactly like weft's starts.ts. */
export function budgetOf(value: unknown): BudgetLimits | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") return parseBudget(value);
  if (typeof value === "object" && !Array.isArray(value)) {
    const raw = value as { tokens?: unknown; usd?: unknown };
    const unknown = Object.keys(raw).filter((key) => key !== "tokens" && key !== "usd");
    if (unknown.length > 0) {
      throw new Error(`start: budget has no field ${unknown.map((k) => JSON.stringify(k)).join(", ")} — it takes tokens, usd`);
    }
    const out: BudgetLimits = {};
    if (raw.tokens !== undefined) {
      if (typeof raw.tokens !== "number" || !Number.isFinite(raw.tokens) || raw.tokens < 0) {
        throw new Error("start: budget.tokens must be a non-negative number");
      }
      out.tokens = raw.tokens;
    }
    if (raw.usd !== undefined) {
      if (typeof raw.usd !== "number" || !Number.isFinite(raw.usd) || raw.usd < 0) {
        throw new Error("start: budget.usd must be a non-negative number");
      }
      out.usd = raw.usd;
    }
    if (out.tokens === undefined && out.usd === undefined) throw new Error("start: budget must set tokens, usd, or both");
    return out;
  }
  throw new Error('start: budget must be a string like "500k" or "$5", or { tokens, usd }');
}

/** Deterministic 0..1 value per seq, so reruns of a seed produce the same numbers. */
function jitter(seq: number): number {
  return (((seq + 1) * 2654435761) >>> 0) / 4294967296;
}

/**
 * Usage for a paid step. Real po-brd agent steps spend ~$0.5-0.9 with 6-12 uncached input
 * tokens, 2.4k-7k output tokens and 70k-215k cache reads; tokens here means input + output.
 */
export function usageFor(seq: number, usd: number | undefined, tokens: number | undefined): Usage | undefined {
  const paidUsd = usd !== undefined && usd > 0 ? usd : undefined;
  const paidTokens = tokens !== undefined && tokens > 0 ? Math.round(tokens) : undefined;
  if (paidUsd === undefined && paidTokens === undefined) return undefined;
  const j = jitter(seq);
  const total = paidTokens ?? Math.max(1, Math.round((paidUsd ?? 0) * (4_200 + j * 3_600)));
  const input = Math.min(Math.max(total - 1, 1), 6 + (seq % 7));
  const usage: Usage = { input, output: total - input };
  if (paidUsd !== undefined) {
    usage.cacheRead = Math.round(paidUsd * (100_000 + j * 150_000));
    usage.usd = paidUsd;
  }
  return usage;
}

export function exhausted(limits: BudgetLimits | null, spend: { tokens: number; usd: number }): boolean {
  if (!limits) return false;
  if (limits.usd !== undefined && spend.usd >= limits.usd) return true;
  if (limits.tokens !== undefined && spend.tokens >= limits.tokens) return true;
  return false;
}
