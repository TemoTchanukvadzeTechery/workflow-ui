import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface FactCellProps {
  label: ReactNode;
  value: ReactNode;
  /** Mono value (ids, paths, durations, token counts). */
  mono?: boolean;
  /** Muted line under the value. */
  hint?: ReactNode;
  className?: string;
}

/** A fact: a muted 13px label over an ink value (STYLE.md 2). Empty values show a muted dash. */
export function FactCell({ label, value, mono, hint, className }: FactCellProps) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="truncate text-[13px] leading-5 text-muted-foreground">{label}</div>
      <div className={cn("min-w-0 truncate text-[15px] leading-6 text-heading", mono && "font-mono text-[13px] leading-6 tabular-nums", empty && "text-muted-foreground")}>
        {empty ? "-" : value}
      </div>
      {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export interface FactStripProps {
  children: ReactNode;
  className?: string;
}

/**
 * A row of FactCells separated by hairline rules, on a 20px-radius panel with a hairline edge.
 * Wraps to a 2-column grid on narrow screens.
 */
export function FactStrip({ children, className }: FactStripProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-rule px-4 py-3.5 sm:flex sm:flex-wrap sm:gap-0 sm:divide-x sm:divide-rule sm:px-0",
        "sm:[&>*]:px-5",
        className,
      )}
    >
      {children}
    </div>
  );
}
