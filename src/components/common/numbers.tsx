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

/** "46,099 tok", mono tabular figures. */
export function Tokens({ n, compact, className }: TokensProps) {
  return (
    <span className={cn("font-mono tabular-nums", className)} title={compact ? formatTokens(n) : undefined}>
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

/** A fixed duration. For a live, ticking one use <Elapsed since={...} />. */
export function Duration({ ms, style = "human", className }: DurationProps) {
  return <span className={cn("tabular-nums", style === "clock" && "font-mono", className)}>{formatDuration(ms, style)}</span>;
}
