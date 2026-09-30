import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/weft/labels";
import { toneClasses } from "./tone";

export interface StripedBarProps {
  value: number;
  max: number;
  /** Stripe color from a status tone (default success). Ignored when `color` is set. */
  tone?: Tone;
  /** Any CSS color for the stripes, e.g. "var(--chart-pink)". */
  color?: string;
  /** Bar height in px; default 14 (the reference). */
  height?: number;
  /** In progress: the same stripes at 60% opacity. */
  partial?: boolean;
  /** Accessible label, e.g. "Online payments: $26,800 of $41,540". */
  label?: string;
  className?: string;
}

/**
 * The reference's striped bar (STYLE.md 5): a full-radius pill of 135deg stripes on a white
 * track. For breakdown bars, progress and wave/epic progress.
 */
export function StripedBar({ value, max, tone = "success", color, height = 14, partial, label, className }: StripedBarProps) {
  const safeMax = Math.max(max, 0);
  const pct = safeMax === 0 ? 0 : Math.min(100, Math.max(0, (value / safeMax) * 100));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={Math.min(Math.max(value, 0), safeMax)}
      aria-label={label ?? `${value} of ${safeMax}`}
      data-slot="striped-bar"
      className={cn("bar-track relative w-full overflow-hidden rounded-full", className)}
      style={{ height }}
    >
      {pct > 0 && (
        <span
          className={cn("absolute inset-y-0 left-0 rounded-full", color ? "stripes" : toneClasses(tone).stripe, partial && "opacity-60")}
          style={{ width: `max(${pct}%, ${height}px)`, ...(color ? ({ "--c": color } as CSSProperties) : {}) }}
        />
      )}
    </div>
  );
}
