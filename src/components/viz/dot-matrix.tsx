import { FloatingChip } from "@/components/common/floating-chip";
import { cn } from "@/lib/utils";

export interface DotMatrixProps {
  /** A count per column (per weekday, per stage...). */
  columns: number[];
  /** One label per column; the chip names the peak column's label. */
  labels?: string[];
  /** Chip prefix before the peak's label: "Peak" gives "Peak: Wed". Default "Peak". */
  peakLabel?: string;
  tone: "green" | "blue";
  /** Rows of dots in the peak column; the others scale to it. Default 5. */
  maxRows?: number;
  /** Dots per row in each column; 2 gives the reference's paired columns. Default 2. */
  dotsPerRow?: 1 | 2;
  /** Dot size in px (gaps scale with it). Default 11. Natural width: n * (2 * dot + gap) + (n - 1) * 0.82 * dot. */
  dotSize?: number;
  /** Noun for the accessible name: "3 runs". Default none. */
  unit?: string;
  ariaLabel?: string;
  className?: string;
}

const CHIP_ROOM = 46;

const TONE = {
  green: { peak: "bg-chart-green", rest: "bg-chart-green-light", glow: "[--chip-glow:var(--chart-green)]" },
  blue: { peak: "bg-chart-blue", rest: "bg-chart-blue-light", glow: "[--chip-glow:var(--chart-blue)]" },
};

/**
 * Dot matrix in the Transactions / Customers style (STYLE.md 5): bottom-aligned columns of 11px
 * rounded dots with 3px gaps, two dots wide, the peak column saturated and the rest light, and a
 * floating chip over the peak. Columns are scaled to the peak, which is `maxRows` tall and ends in
 * a single dot; the others keep their share of it, at least one dot when non-zero, with the odd
 * dot on the side facing the peak. An empty column shows one faint placeholder.
 */
export function DotMatrix({ columns, labels, peakLabel = "Peak", tone, maxRows = 5, dotsPerRow = 2, dotSize = 11, unit, ariaLabel, className }: DotMatrixProps) {
  const DOT = dotSize;
  const GAP = Math.max(2, Math.round((dotSize * 3) / 11));
  const COL_GAP = Math.round(dotSize * 0.82);
  const RADIUS = Math.round(dotSize * 0.36);
  // The peak fills `maxRows` rows with a single dot on top, as in the reference.
  const capacity = Math.max(1, maxRows * dotsPerRow - (dotsPerRow - 1));
  const most = Math.max(0, ...columns);
  const peak = most > 0 ? columns.indexOf(most) : -1;
  const dots = columns.map((c) => (c <= 0 || most <= 0 ? 0 : Math.max(1, Math.round((c / most) * capacity))));
  const colW = dotsPerRow * DOT + (dotsPerRow - 1) * GAP;
  const t = TONE[tone];

  const name =
    ariaLabel ??
    [
      columns.map((c, i) => `${labels?.[i] ?? `Column ${i + 1}`}: ${c}${unit ? ` ${unit}` : ""}`).join(", "),
      peak >= 0 ? `${peakLabel}: ${labels?.[peak] ?? columns[peak]}` : "",
    ]
      .filter(Boolean)
      .join(". ");

  return (
    <div role="img" aria-label={name} className={cn("relative inline-flex max-w-full flex-col", className)} style={{ paddingTop: peak >= 0 ? CHIP_ROOM : 0 }}>
      {peak >= 0 && (
        <span className="absolute top-0 -translate-x-1/2" style={{ left: peak * (colW + COL_GAP) + colW / 2 }}>
          <FloatingChip label={peakLabel} value={labels?.[peak] ?? String(columns[peak])} className={t.glow} />
        </span>
      )}
      <div className="flex items-end" style={{ gap: COL_GAP }}>
        {dots.map((d, i) => {
          // Split the column's dots over its sub-columns; the odd one leans toward the peak.
          const base = Math.floor(d / dotsPerRow);
          const extra = d % dotsPerRow;
          const leanRight = peak < 0 || i <= peak;
          const heights = Array.from({ length: dotsPerRow }, (_, k) => base + (extra > 0 && k === (leanRight ? dotsPerRow - 1 : 0) ? 1 : 0));
          return (
            <div key={i} className="flex items-end" style={{ gap: GAP, width: colW }}>
              {heights.map((hk, k) => {
                const ghost = d === 0 && k === 0;
                const count = ghost ? 1 : hk;
                return (
                  <div key={k} className="flex flex-col" style={{ gap: GAP, width: DOT }}>
                    {Array.from({ length: count }, (_, r) => (
                      <span
                        key={r}
                        className={cn("shrink-0 transition-colors duration-300", ghost ? "bg-well" : i === peak ? t.peak : t.rest)}
                        style={{ width: DOT, height: DOT, borderRadius: RADIUS }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
