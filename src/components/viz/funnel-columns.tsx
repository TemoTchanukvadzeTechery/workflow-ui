"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { GlassTooltip, type GlassTooltipItem } from "@/components/common/glass-tooltip";
import { cn } from "@/lib/utils";
import { useElementSize } from "./use-element-size";

export interface FunnelColumn {
  key: string;
  /** Top label, 14px muted ("Requirements"). */
  label: string;
  /** Drives the bar height. */
  value: number;
  /** The formatted number shown under the label ("65.2k", "3"). */
  display: string;
  /** Extra words for the accessible name ("2 need input"). */
  hint?: string;
}

export interface FunnelColumnsProps {
  columns: FunnelColumn[];
  /** Controlled active column. Omit to let the chart keep its own (starting at `defaultActiveKey`). */
  activeKey?: string;
  /** Uncontrolled starting column; default the first. */
  defaultActiveKey?: string;
  /** Hover, focus and arrow keys make a column active. */
  onActiveChange?: (key: string) => void;
  /** Click, Enter or Space on a column. */
  onSelect?: (key: string) => void;
  /** Segments of the GlassTooltip over the active bar ("48.6k transactions | Conversion: 89%"); omit for none. */
  tooltip?: (column: FunnelColumn, index: number) => GlassTooltipItem[];
  /** Height of the bar area in px (the labels sit above it). Default 200. With `fill`, the least height. */
  height?: number;
  /**
   * Stretch to the parent's height: the bar area grows to fill it (measured, so bars, axis and
   * tooltip follow). Give the chart a height from a flex column, e.g. a `flex flex-1 flex-col` wrapper.
   */
  fill?: boolean;
  /** Value of a full-height bar; default the largest value. */
  max?: number;
  /** Value at the bottom of the bar area. Keep 0 (the default) for counts; a higher baseline exaggerates differences. */
  baseline?: number;
  /** Optional y-axis ticks drawn in a 44px gutter on the left ("70k" at 70000). */
  axis?: Array<{ value: number; label: string }>;
  /** Accessible name of the column group. Default "Funnel". */
  ariaLabel?: string;
  className?: string;
}

/** Share of a column the bar takes; the rest is the sloped side face down to the next bar. */
const BAR_W = 0.88;
/** Headroom in px over the tallest bar: room for the marker pill, which sits just under the column value. */
const HEAD_PX = 18;
/** The tallest bar takes at least this % of the bar area, even when the area is short. */
const HEADROOM = 90;

// Each bar dissolves from #1D5BF0 to near-white by about 60% of its height (the reference's airy
// look); the stripes ride on top. In dark the whole bar fades out (mask), stripes included.
const BAR = [
  "bg-[repeating-linear-gradient(135deg,rgba(255,255,255,.85)_0_2px,transparent_2px_10px),linear-gradient(180deg,#1D5BF0_0%,#3D7CF4_26%,rgba(120,170,250,.55)_52%,rgba(191,227,255,.16)_78%)]",
  "shadow-[inset_0_1px_0_rgba(255,255,255,.55)]",
  "dark:bg-[repeating-linear-gradient(135deg,rgba(255,255,255,.34)_0_2px,transparent_2px_10px),linear-gradient(180deg,#2458EA_0%,#2A66EC_26%,rgba(36,99,230,.3)_52%,rgba(36,99,230,.04)_75%)]",
  "dark:shadow-[inset_0_1px_0_rgba(255,255,255,.25)] dark:[mask-image:linear-gradient(180deg,#000_0%,#000_40%,rgba(0,0,0,.12)_82%,transparent_100%)]",
].join(" ");

const BAR_ACTIVE = [
  "bg-[radial-gradient(80%_110%_at_0%_100%,rgba(96,165,255,.6),transparent_62%),linear-gradient(100deg,#1B70FC_0%,#2A5DF1_48%,#3B2FD8_100%)]",
  "shadow-[inset_0_1px_0_rgba(255,255,255,.6),0_-10px_30px_-10px_rgba(27,112,252,.6)]",
  "dark:shadow-[inset_0_1px_0_rgba(255,255,255,.35),0_-10px_34px_-8px_rgba(27,112,252,.55)]",
].join(" ");

/** The sloped face between two bars, sized to the taller one so it fades with the bars. */
const SIDE =
  "bg-[linear-gradient(180deg,rgba(118,163,246,.95)_0%,rgba(168,199,250,.6)_36%,rgba(218,232,253,0)_70%)] dark:bg-[linear-gradient(180deg,rgba(76,126,240,.55)_0%,rgba(46,86,190,.18)_40%,rgba(30,60,140,0)_70%)]";

const MARKER =
  "h-1.5 w-7 rounded-full bg-[linear-gradient(180deg,#C6DDFE,#5D9BF6)] shadow-[0_0_0_1.5px_#fff,0_3px_6px_-2px_rgba(27,111,252,.55)] dark:shadow-[0_0_0_1.5px_rgba(255,255,255,.3),0_3px_8px_-2px_rgba(27,111,252,.7)]";

/**
 * Funnel columns in the Payments style (STYLE.md 5): columns split by hairlines, a muted label and
 * value over a striped gradient bar, a sloped side face into the next bar, and a pill marker. The
 * active column (hover, focus, arrow keys) has a solid gradient bar, a glow behind it and a glass
 * tooltip. A radio group: one tab stop, arrows move, Enter or click selects.
 */
export function FunnelColumns({
  columns,
  activeKey,
  defaultActiveKey,
  onActiveChange,
  onSelect,
  tooltip,
  height = 200,
  fill = false,
  max,
  baseline = 0,
  axis,
  ariaLabel = "Funnel",
  className,
}: FunnelColumnsProps) {
  const [ownKey, setOwnKey] = useState(defaultActiveKey ?? columns[0]?.key);
  const current = activeKey ?? ownKey;
  const found = columns.findIndex((c) => c.key === current);
  const activeIndex = found < 0 ? 0 : found;
  const cells = useRef<(HTMLDivElement | null)[]>([]);
  const [gridRef, grid] = useElementSize<HTMLDivElement>();
  const [tipRef, tip] = useElementSize<HTMLDivElement>();
  const [areaRef, area] = useElementSize<HTMLDivElement>();
  const tipId = useId();
  const n = columns.length;

  // The bar area's height: fixed, or (fill) measured from the first column, `height` until then.
  const barH = fill && area.height > 0 ? area.height : height;
  /** The tallest bar as % of the bar area. */
  const scale = Math.max(HEADROOM, ((barH - HEAD_PX) / barH) * 100);
  const top = Math.max(max ?? 0, ...columns.map((c) => c.value), baseline + 1);
  /** Bar height as % of the bar area; a non-zero value never drops below a visible sliver. */
  const pos = (v: number) => ((v - baseline) / (top - baseline)) * scale;
  const pct = (v: number) => (v <= 0 ? 0 : Math.max(4, pos(v)));

  const activate = (i: number, focus = false) => {
    const col = columns[i];
    if (!col) return;
    if (col.key !== current) {
      setOwnKey(col.key);
      onActiveChange?.(col.key);
    }
    if (focus) cells.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, i: number) => {
    let next: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (i + 1) % n;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (i - 1 + n) % n;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = n - 1;
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        onSelect?.(columns[i].key);
        return;
      default:
        return;
    }
    e.preventDefault();
    activate(next, true);
  };

  const active = columns[activeIndex];
  const tipItems = active && tooltip ? tooltip(active, activeIndex) : [];
  const activeH = active ? pct(active.value) : 0;
  // Centre the tooltip over the active bar, then clamp it inside the chart.
  const barCenter = (activeIndex + (activeIndex < n - 1 ? BAR_W : 1) / 2) * (grid.width / Math.max(n, 1));
  const tipLeft = Math.min(Math.max(barCenter - tip.width / 2, 0), Math.max(grid.width - tip.width, 0));
  const measured = grid.width > 0 && tip.width > 0;
  // Float the tooltip 18px over the active bar, but keep it inside the bar area, so a tall bar or
  // a wrapped (narrow) tooltip never covers the column values above.
  const tipBottom = Math.max(0, Math.min((activeH / 100) * barH + 18, barH - tip.height - 4));

  return (
    <div className={cn("@container/funnel relative flex w-full min-w-0", fill && "min-h-0 flex-1", className)}>
      {axis && axis.length > 0 && (
        <div aria-hidden className="relative w-11 shrink-0 self-end" style={{ height: barH }}>
          {axis
            .filter((t) => t.value >= baseline && t.value <= top)
            .map((t) => (
              <span key={t.value} className="absolute left-0 translate-y-1/2 text-[13px] leading-none text-muted-foreground tabular-nums" style={{ bottom: `${pos(t.value)}%` }}>
                {t.label}
              </span>
            ))}
        </div>
      )}
      <div
        ref={gridRef}
        role="radiogroup"
        aria-label={ariaLabel}
        className="relative grid min-w-0 flex-1"
        style={{ gridTemplateColumns: `repeat(${Math.max(n, 1)}, minmax(0, 1fr))` }}
      >
        {columns.map((c, i) => {
          const on = i === activeIndex;
          const h = pct(c.value);
          const last = i === n - 1;
          const nextH = last ? 0 : pct(columns[i + 1].value);
          const faceH = Math.max(h, nextH);
          return (
            <div
              key={c.key}
              ref={(el) => {
                cells.current[i] = el;
              }}
              role="radio"
              aria-checked={on}
              aria-label={`${c.label}: ${c.display}${c.hint ? `, ${c.hint}` : ""}`}
              aria-describedby={on && tipItems.length > 0 ? tipId : undefined}
              tabIndex={on ? 0 : -1}
              onMouseEnter={() => activate(i)}
              onFocus={() => activate(i)}
              onClick={() => {
                activate(i);
                onSelect?.(c.key);
              }}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "group/col relative flex min-w-0 cursor-pointer flex-col border-l border-rule outline-none select-none",
                last && "border-r",
                "focus-visible:z-10 focus-visible:rounded-[6px] focus-visible:ring-3 focus-visible:ring-ring/50",
              )}
            >
              {/* The active column glows from the bar upward. */}
              <div
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-0 transition-opacity duration-300",
                  "bg-[linear-gradient(180deg,rgba(236,244,255,.15)_0%,rgba(226,238,255,.9)_40%,#D1E4FD_100%)] dark:bg-[linear-gradient(180deg,rgba(27,111,252,0)_0%,rgba(27,111,252,.1)_45%,rgba(27,111,252,.2)_100%)]",
                  on ? "opacity-100" : "opacity-0",
                )}
              />
              <div className="relative min-w-0 px-1.5 pt-0.5 pb-1 @md/funnel:px-2 @xl/funnel:px-3 @xl/funnel:pb-1.5 @3xl/funnel:px-3.5">
                <div className={cn("truncate text-[11px] leading-4 transition-colors @md/funnel:text-[12px] @md/funnel:leading-5 @xl/funnel:text-[13px] @5xl/funnel:text-[14px]", on ? "text-heading" : "text-muted-foreground")}>{c.label}</div>
                <div
                  className={cn(
                    "mt-1 truncate text-[16px] leading-6 tracking-[-0.02em] tabular-nums transition-colors @md/funnel:text-[20px] @md/funnel:leading-7 @xl/funnel:mt-1.5 @xl/funnel:text-[26px] @xl/funnel:leading-8",
                    on ? "text-heading" : "text-muted-numeral",
                  )}
                >
                  {c.display}
                </div>
              </div>
              <div
                ref={i === 0 ? areaRef : undefined}
                className={cn("relative", fill ? "min-h-0 flex-1" : "mt-auto")}
                style={fill ? { minHeight: height } : { height }}
              >
                {!last && faceH > 0 && (
                  <div
                    aria-hidden
                    className={cn("absolute right-0 bottom-0 transition-[height,clip-path] duration-500 ease-out", SIDE)}
                    style={{
                      width: `${(1 - BAR_W) * 100}%`,
                      height: `${faceH}%`,
                      clipPath: `polygon(0 ${100 - (h / faceH) * 100}%, 100% ${100 - (nextH / faceH) * 100}%, 100% 100%, 0 100%)`,
                    }}
                  />
                )}
                <div
                  aria-hidden
                  className={cn("absolute bottom-0 left-0 transition-[height] duration-500 ease-out", on ? BAR_ACTIVE : BAR)}
                  style={{ height: `${h}%`, width: last ? "100%" : `${BAR_W * 100}%` }}
                />
                {h > 0 && (
                  <span
                    aria-hidden
                    className={cn("absolute -translate-x-1/2 transition-[bottom,opacity] duration-500 ease-out", MARKER, on && "opacity-0")}
                    style={{ left: `${(last ? 1 : BAR_W) * 50}%`, bottom: `calc(${h}% + 8px)` }}
                  />
                )}
              </div>
            </div>
          );
        })}

        {tipItems.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20" style={{ height: barH }}>
            <div
              ref={tipRef}
              className={cn("absolute w-max max-w-full transition-[left,bottom,opacity] duration-300 ease-out", measured ? "opacity-100" : "opacity-0")}
              style={{ left: tipLeft, bottom: tipBottom }}
            >
              <GlassTooltip id={tipId} items={tipItems} className="h-auto min-h-8 flex-wrap gap-y-0.5 rounded-[16px] py-1.5 whitespace-normal [&>span]:whitespace-nowrap" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
