import { formatDuration, formatTokens, formatUsd, type DurationStyle } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface MoneyProps {
  usd: number | null | undefined;
  /** "$12.4K" above $10,000. */
  compact?: boolean;
  className?: string;
}

/** "$6.92", tabular figures. */
export function Money({ usd, compact, className }: MoneyProps) {
  return <span className={cn("tabular-nums", className)}>{formatUsd(usd, { compact })}</span>;
}

export interface TokensProps {
  n: number | null | undefined;
  /** "941.9k tok" instead of "941,920 tok". */
  compact?: boolean;
  className?: string;
}

/**
 * "46,099 tok", tabular figures in the text face. Not mono: Geist Mono gives "," a full cell, so
 * "46,099" would read "46, 099" (STYLE.md 2 keeps mono for ids, paths, JSON, diffs and logs).
 */
export function Tokens({ n, compact, className }: TokensProps) {
  return (
    <span className={cn("tabular-nums", className)} title={compact ? formatTokens(n) : undefined}>
      {formatTokens(n, { compact })}
    </span>
  );
}

export interface DurationProps {
  ms: number | null | undefined;
  /** "human" (default): "2m 14s"; "clock": "02:14". */
  style?: DurationStyle;
  className?: string;
}

/** A fixed duration, tabular figures ("clock" too: mono would space the colons out). For a live, ticking one use <Elapsed since={...} />. */
export function Duration({ ms, style = "human", className }: DurationProps) {
  return <span className={cn("tabular-nums", className)}>{formatDuration(ms, style)}</span>;
}
