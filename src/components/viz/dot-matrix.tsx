import { cn } from "@/lib/utils";
import { VizChip } from "./chips";

export interface DotMatrixProps {
  /** A count per column (per weekday, per stage...). */
  columns: number[];
  /** One label per column; the chip names the peak column's label. */
  labels?: string[];
  /** Chip prefix before the peak's label: "Peak" gives "Peak: Wed". Default "Peak". */
  peakLabel?: string;
  tone: "green" | "blue";
  /** Tallest column, in rows of dots. Counts that do not fit are scaled down. Default 4. */
  maxRows?: number;
  /** Dots per row in each column; 2 gives the reference's paired columns. Default 2. */
  dotsPerRow?: 1 | 2;
  /** Dot diameter in px (gaps scale with it). Default 11. Natural width: n * (2 * dot + gap) + (n - 1) * 10/11 * dot. */
  dotSize?: number;
  /** Noun for the accessible name: "3 runs". Default none. */
  unit?: string;
  ariaLabel?: string;
  className?: string;
}

const CHIP_ROOM = 46;

const TONE = {
  green: { peak: "bg-[#0DAA2C]", rest: "bg-[#9CD6A3] dark:bg-[#0DAA2C]/40", chip: "green" as const },
  blue: { peak: "bg-[#1976FF]", rest: "bg-[#A1CBF8] dark:bg-[#1976FF]/40", chip: "blue" as const },
};

/**
 * Dot matrix in the Transactions / Customers style (STYLE.md 5): columns of 11px dots with 3px
 * gaps, the peak column saturated and the rest light, and a floating chip over the peak. One dot
 * per unit while the tallest column fits in `maxRows`; beyond that dots are scaled, and a
 * non-zero column always keeps at least one dot. An empty column shows one faint placeholder.
 */
export function DotMatrix({ columns, labels, peakLabel = "Peak", tone, maxRows = 4, dotsPerRow = 2, dotSize = 11, unit, ariaLabel, className }: DotMatrixProps) {
  const DOT = dotSize;
  const GAP = Math.max(2, Math.round((dotSize * 3) / 11));
  const COL_GAP = Math.round((dotSize * 10) / 11);
  const capacity = maxRows * dotsPerRow;
  const most = Math.max(0, ...columns);
  const peak = most > 0 ? columns.indexOf(most) : -1;
  const dots = columns.map((c) => (c <= 0 ? 0 : most <= capacity ? c : Math.max(1, Math.round((c / most) * capacity))));
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
        <VizChip
          label={peakLabel}
          value={labels?.[peak] ?? String(columns[peak])}
          tone={t.chip}
          className="absolute top-0 -translate-x-1/2"
          style={{ left: peak * (colW + COL_GAP) + colW / 2 }}
        />
      )}
      <div className="flex items-end" style={{ gap: COL_GAP }}>
        {dots.map((d, i) => {
          const rows = Math.max(1, Math.ceil(d / dotsPerRow));
          return (
            <div key={i} className="flex flex-col-reverse" style={{ gap: GAP, width: colW }}>
              {Array.from({ length: rows }, (_, r) => (
                <div key={r} className="flex" style={{ gap: GAP }}>
                  {Array.from({ length: dotsPerRow }, (_, k) => {
                    const idx = r * dotsPerRow + k;
                    const filled = idx < d;
                    const ghost = d === 0 && r === 0 && k === 0;
                    return (
                      <span
                        key={k}
                        className={cn(
                          "shrink-0 rounded-full transition-colors duration-300",
                          filled ? (i === peak ? t.peak : t.rest) : ghost ? "bg-[#E4E4E4] dark:bg-white/10" : "bg-transparent",
                        )}
                        style={{ width: DOT, height: DOT }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
