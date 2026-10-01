"use client";

import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A frontmatter `YYYY-MM-DD` as local midnight, so a date never reads as hours in the future. */
export function localDayMs(iso: string | null | undefined): number {
  const m = iso ? ISO_DAY.exec(iso) : null;
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/** "Today", "Yesterday", "3 days ago", then "Sep 12" (or "Sep 12, 2025" in another year). */
export function formatDay(iso: string | null | undefined, now: number): string | null {
  const day = localDayMs(iso);
  if (!Number.isFinite(day)) return null;
  const today = new Date(now);
  const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const days = Math.round((todayMs - day) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return `${days} days ago`;
  const d = new Date(day);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Day-granularity label for a note's `updated` date; the ISO date is in the title. */
export function DayLabel({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const now = useNow(60_000);
  const text = formatDay(iso, now);
  if (!text) return <span className={cn("text-muted-foreground", className)}>-</span>;
  return (
    <time dateTime={iso ?? undefined} title={iso ?? undefined} className={cn("whitespace-nowrap", className)} suppressHydrationWarning>
      {text}
    </time>
  );
}
