"use client";

import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/weft/labels";
import { toneClasses } from "./tone";
import { revealInScroller, useScrollFade } from "./use-scroll-fade";

export interface SegmentedItem<V extends string = string> {
  value: V;
  label: ReactNode;
  /** A small muted count after the label, or a soft tone chip when `countTone` is set. */
  count?: number;
  /** Show the count as a soft chip in this tone (for counts that need action). */
  countTone?: Tone;
  icon?: LucideIcon;
  disabled?: boolean;
  /** Accessible name when the label is not plain text (or is hidden on small screens). */
  ariaLabel?: string;
  /** With `role="tablist"`: the id of the panel this tab controls. */
  controls?: string;
  /** DOM id of the segment (for aria-labelledby on a tab panel). */
  id?: string;
  title?: string;
}

export interface SegmentedControlProps<V extends string = string> {
  value: V;
  onValueChange: (value: V) => void;
  items: readonly SegmentedItem<V>[];
  /** sm 36px, md 44px (default, the reference), lg 48px. */
  size?: "sm" | "md" | "lg";
  /** radiogroup (default) for filters and settings, tablist for switching panels. */
  role?: "radiogroup" | "tablist";
  /** Stretch segments to fill the width. */
  fullWidth?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
  /** Classes for every segment. */
  itemClassName?: string;
}

const TRACK = { sm: "h-9 rounded-[12px] p-[3px]", md: "h-11 rounded-[16px] p-1", lg: "h-12 rounded-[16px] p-1" } as const;
const SEGMENT = { sm: "rounded-[9px] px-3 text-[13px]", md: "rounded-[12px] px-3.5 text-sm", lg: "rounded-[12px] px-4 text-[15px]" } as const;

/**
 * The reference's segmented control (STYLE.md 3): a well track with the selected segment raised.
 * Always one row: when the segments do not fit, the track scrolls sideways (no scrollbar), fades
 * out at the edge that has more, and keeps the selected segment in view.
 * Keyboard: one tab stop; arrow keys, Home and End move and select (skipping disabled items).
 */
export function SegmentedControl<V extends string = string>({
  value,
  onValueChange,
  items,
  size = "md",
  role = "radiogroup",
  fullWidth,
  className,
  itemClassName,
  ...aria
}: SegmentedControlProps<V>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const fadeRef = useScrollFade<HTMLDivElement>();
  const setTrack = useCallback(
    (el: HTMLDivElement | null) => {
      trackRef.current = el;
      const cleanup = fadeRef(el);
      return () => {
        cleanup?.();
        trackRef.current = null;
      };
    },
    [fadeRef],
  );
  const tabs = role === "tablist";
  const selectedIndex = items.findIndex((i) => i.value === value);

  // A selection made elsewhere (a link, a keyboard shortcut) can land on a hidden segment.
  useEffect(() => {
    if (trackRef.current) revealInScroller(trackRef.current, refs.current[selectedIndex]);
  }, [selectedIndex]);
  // The tab stop is the selected segment, else the first enabled one.
  const focusIndex = selectedIndex >= 0 && !items[selectedIndex]?.disabled ? selectedIndex : items.findIndex((i) => !i.disabled);

  const move = (from: number, e: KeyboardEvent<HTMLButtonElement>) => {
    const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
    if (enabled.length === 0) return;
    const pos = enabled.indexOf(from);
    let next: number | undefined;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = enabled[(pos + 1) % enabled.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = enabled[(pos - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (next === undefined) return;
    e.preventDefault();
    refs.current[next]?.focus();
    const it = items[next];
    if (it && it.value !== value) onValueChange(it.value);
  };

  return (
    <div
      ref={setTrack}
      role={role}
      aria-orientation={tabs ? "horizontal" : undefined}
      data-slot="segmented-control"
      className={cn("row-scroll-x inline-flex max-w-full min-w-0 items-center gap-1 bg-well", TRACK[size], fullWidth && "flex w-full", className)}
      {...aria}
    >
      {items.map((it, i) => {
        const selected = it.value === value;
        const Icon = it.icon;
        const countChip = it.countTone ? toneClasses(it.countTone) : null;
        return (
          <button
            key={it.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            id={it.id}
            role={tabs ? "tab" : "radio"}
            aria-checked={tabs ? undefined : selected}
            aria-selected={tabs ? selected : undefined}
            aria-controls={tabs ? it.controls : undefined}
            aria-label={it.ariaLabel}
            title={it.title}
            disabled={it.disabled}
            tabIndex={i === focusIndex ? 0 : -1}
            data-state={selected ? "on" : "off"}
            onClick={() => !selected && onValueChange(it.value)}
            onKeyDown={(e) => move(i, e)}
            className={cn(
              "inline-flex h-full min-w-0 shrink-0 items-center justify-center gap-1.5 font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-(--disabled-opacity)",
              SEGMENT[size],
              fullWidth && "flex-1",
              selected ? "bg-raised text-heading shadow-(--raised-shadow)" : "text-muted-foreground hover:text-heading",
              itemClassName,
            )}
          >
            {Icon && <Icon aria-hidden className={size === "sm" ? "size-3.5" : "size-4"} strokeWidth={1.9} />}
            <span className="truncate">{it.label}</span>
            {it.count !== undefined &&
              (countChip ? (
                <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums", countChip.bg, countChip.text)}>
                  {it.count}
                </span>
              ) : (
                <span className="text-xs font-normal text-muted-foreground tabular-nums">{it.count}</span>
              ))}
          </button>
        );
      })}
    </div>
  );
}
