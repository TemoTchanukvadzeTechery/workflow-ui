"use client";

import { useId, useState, type PointerEvent, type ReactNode } from "react";
import { FloatingChip } from "@/components/common/floating-chip";
import { cn } from "@/lib/utils";
import { useElementSize } from "./use-element-size";

export interface StepAreaChartProps {
  /** One step per point, left to right. */
  data: Array<{ label: string; value: number }>;
  /** Step that carries the marker dot and the floating chip when nothing is hovered. */
  highlightIndex?: number;
  /** Chip text for the highlighted step; default `formatValue(value)`. */
  chipLabel?: ReactNode;
  /** Axis labels spread evenly under the chart ("Jan" ... "Jun"); default a thinned set of the data labels. */
  xLabels?: string[];
  /** Total height in px, including 44px of headroom for the chip. Default 240. */
  height?: number;
  /** Formats a value for the chip and the screen-reader list. Default `String(value)`. */
  formatValue?: (value: number, index: number) => string;
  /** Accessible name of the chart. */
  ariaLabel?: string;
  className?: string;
}

const HEADROOM = 44;
const STROKE = 2.5;

function thinLabels(data: StepAreaChartProps["data"], want = 6): string[] {
  if (data.length <= want + 2) return data.map((d) => d.label);
  const step = (data.length - 1) / (want - 1);
  return Array.from({ length: want }, (_, i) => data[Math.round(i * step)].label);
}

/**
 * Step area chart in the Retention style (STYLE.md 5): a 2.5px pink `stepAfter` line over an area
 * of vertical pink stripes that fades out toward the baseline, a marker dot with a floating chip,
 * and 13px muted axis labels. Hovering a step moves the marker and chip to it.
 */
export function StepAreaChart({ data, highlightIndex, chipLabel, xLabels, height = 240, formatValue = (v) => String(v), ariaLabel = "Step chart", className }: StepAreaChartProps) {
  const [boxRef, box] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");
  const W = box.width;
  const H = height;
  const n = data.length;
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  const bottom = H - 1;
  const y = (v: number) => bottom - (Math.max(v, 0) / (max * 1.06)) * (bottom - HEADROOM - STROKE);
  const stepW = n > 0 ? W / n : 0;

  let line = "";
  if (n > 0 && W > 0) {
    line = `M${STROKE / 2},${y(data[0].value)}`;
    for (let i = 0; i < n; i++) {
      const xEnd = i === n - 1 ? W - STROKE / 2 : (i + 1) * stepW;
      line += ` H${xEnd}`;
      if (i < n - 1) line += ` V${y(data[i + 1].value)}`;
    }
  }
  const area = line ? `${line} V${bottom} H${STROKE / 2} Z` : "";

  const shown = hover ?? highlightIndex ?? -1;
  const point = shown >= 0 && shown < n ? data[shown] : undefined;
  const cx = Math.min(Math.max(shown * stepW, 5), W - 5);
  const cy = point ? y(point.value) : 0;
  const chipText = point ? (shown === highlightIndex && chipLabel != null ? chipLabel : formatValue(point.value, shown)) : null;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!stepW) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.min(n - 1, Math.max(0, Math.floor((e.clientX - rect.left) / stepW)));
    setHover(i);
  };

  const labels = xLabels ?? thinLabels(data);

  return (
    <figure aria-label={ariaLabel} className={cn("relative m-0 w-full min-w-0", className)}>
      <div ref={boxRef} className="relative w-full" style={{ height: H }}>
        {W > 0 && (
          <svg aria-hidden width={W} height={H} className="absolute inset-0 block overflow-visible" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            <defs>
              <pattern id={`${uid}-stripes`} width="6" height="8" patternUnits="userSpaceOnUse">
                <rect width="2" height="8" className="fill-chart-pink opacity-[.18] dark:opacity-[.32]" />
              </pattern>
              <linearGradient id={`${uid}-fade`} gradientUnits="userSpaceOnUse" x1="0" y1={HEADROOM} x2="0" y2={bottom}>
                <stop offset="0" stopColor="#fff" stopOpacity="1" />
                <stop offset="0.7" stopColor="#fff" stopOpacity="0.45" />
                <stop offset="1" stopColor="#fff" stopOpacity="0.08" />
              </linearGradient>
              <linearGradient id={`${uid}-tint`} gradientUnits="userSpaceOnUse" x1="0" y1={HEADROOM} x2="0" y2={bottom}>
                <stop offset="0" stopOpacity="0.08" className="[stop-color:var(--chart-pink)]" />
                <stop offset="1" stopOpacity="0" className="[stop-color:var(--chart-pink)]" />
              </linearGradient>
              <mask id={`${uid}-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
                <rect width={W} height={H} fill={`url(#${uid}-fade)`} />
              </mask>
            </defs>
            <line x1="0" x2={W} y1={bottom + 0.5} y2={bottom + 0.5} className="stroke-border" strokeWidth="1" />
            <path d={area} fill={`url(#${uid}-tint)`} />
            <path d={area} fill={`url(#${uid}-stripes)`} mask={`url(#${uid}-mask)`} />
            <path d={line} fill="none" className="stroke-chart-pink" strokeWidth={STROKE} strokeLinejoin="miter" strokeLinecap="butt" />
            {point && (
              <>
                <line x1={cx} x2={cx} y1={cy + 6} y2={bottom} strokeOpacity="0.3" strokeDasharray="2 3" className={cn("stroke-chart-pink", hover == null && "opacity-0")} />
                <circle cx={cx} cy={cy - 5} r="4.5" className="fill-chart-pink stroke-card" strokeWidth="2" />
              </>
            )}
            {/* Transparent hit area so the pointer is tracked over the whole plot, not just the paths. */}
            <rect width={W} height={H} fill="transparent" />
          </svg>
        )}
        {point && chipText != null && (
          <span className="pointer-events-none absolute -translate-x-1/2 transition-[left,top] duration-200 ease-out" style={{ left: Math.min(Math.max(cx, 34), W - 34), top: Math.max(cy - 50, 0) }}>
            <FloatingChip value={chipText} className="[--chip-glow:var(--chart-pink)]" />
          </span>
        )}
      </div>
      {labels.length > 0 && (
        <div aria-hidden className="mt-3 flex justify-between gap-2 text-[13px] leading-none text-muted-foreground">
          {labels.map((l, i) => (
            <span key={`${i}:${l}`} className="min-w-0 truncate">
              {l}
            </span>
          ))}
        </div>
      )}
      <ul className="sr-only">
        {data.map((d, i) => (
          <li key={`${i}:${d.label}`}>
            {d.label}: {formatValue(d.value, i)}
          </li>
        ))}
      </ul>
    </figure>
  );
}
