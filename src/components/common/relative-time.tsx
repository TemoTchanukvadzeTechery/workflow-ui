"use client";

import { useNow } from "@/hooks/use-now";
import { formatDateTime, formatDuration, formatRelative, type DurationStyle } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface RelativeTimeProps {
  /** Epoch ms or Date. Missing values render a muted dash. */
  at: number | Date | null | undefined;
  className?: string;
  /** Text before the relative time, e.g. "updated". */
  prefix?: string;
}

/** "3m ago", refreshed every 30 s from a shared ticker; the absolute time is in the title. */
export function RelativeTime({ at, className, prefix }: RelativeTimeProps) {
  const now = useNow(30_000);
  const t = at === null || at === undefined ? NaN : typeof at === "number" ? at : at.getTime();
  if (!Number.isFinite(t)) return <span className={cn("text-muted-foreground", className)}>-</span>;
  // The shared ticker can lag real time by up to one period; a just-created item would otherwise
  // read "in 20s". Real future times (deadlines) are further out and keep their "in ..." form.
  const ref = t > now && t - now < 60_000 ? t : now;
  return (
    <time dateTime={new Date(t).toISOString()} title={formatDateTime(t)} className={cn("whitespace-nowrap", className)} suppressHydrationWarning>
      {prefix ? `${prefix} ` : ""}
      {formatRelative(t, ref)}
    </time>
  );
}

export interface ElapsedProps {
  /** Start, epoch ms. */
  since: number;
  /** End, epoch ms. While absent the value ticks every second. */
  until?: number;
  style?: DurationStyle;
  className?: string;
}

/** Live elapsed time for running steps and runs ("02:14" or "2m 14s"); static once `until` is set. */
export function Elapsed({ since, until, style = "clock", className }: ElapsedProps) {
  const now = useNow(1_000);
  const end = until ?? Math.max(now, since);
  return (
    <span className={cn("tabular-nums", className)} suppressHydrationWarning>
      {formatDuration(end - since, style)}
    </span>
  );
}
