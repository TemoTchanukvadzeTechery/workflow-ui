import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/weft/labels";
import { toneClasses } from "./tone";

export interface DeltaTriangleProps {
  direction: "up" | "down";
  tone?: Tone;
  className?: string;
}

/** The reference's small filled delta triangle, with a screen-reader word for its direction. */
export function DeltaTriangle({ direction, tone = "success", className }: DeltaTriangleProps) {
  return (
    <>
      <svg
        aria-hidden
        viewBox="0 0 10 8"
        className={cn("h-2 w-2.5 shrink-0 fill-current", toneClasses(tone).solidText, direction === "down" && "rotate-180", className)}
      >
        <path d="M5 0.6 9.4 7.4H0.6Z" strokeLinejoin="round" />
      </svg>
      <span className="sr-only">{direction === "up" ? "Up " : "Down "}</span>
    </>
  );
}

export interface FloatingChipProps {
  /** Muted part, e.g. "Peak" (a colon is added to plain strings). */
  label?: ReactNode;
  /** Ink part, e.g. "Wed", "42%". */
  value: ReactNode;
  /** Tints the glow, the icon and the delta triangle. Default neutral. */
  tone?: Tone;
  icon?: LucideIcon;
  /** Adds a colored ▲ / ▼ before the value (a delta pill such as "▲ 15%"). */
  delta?: "up" | "down";
  size?: "sm" | "md";
  className?: string;
  title?: string;
}

/**
 * A white floating chip (STYLE.md 3): "Peak: Wed", "42%", "▲ 15%". 30px tall with a tone-tinted
 * glow; the label is muted and the value ink. Position it yourself (absolute over a chart, or
 * inline after a hero number).
 */
export function FloatingChip({ label, value, tone = "neutral", icon: Icon, delta, size = "md", className, title }: FloatingChipProps) {
  const t = toneClasses(tone);
  const labelText = typeof label === "string" && !/:\s*$/.test(label) ? `${label}:` : label;
  return (
    <span data-slot="floating-chip" data-tone={tone} title={title} className={cn("chip-float", t.glow, size === "sm" && "h-6! gap-1! px-2! text-xs!", className)}>
      {delta && <DeltaTriangle direction={delta} tone={tone === "neutral" ? (delta === "up" ? "success" : "danger") : tone} />}
      {Icon && <Icon aria-hidden className={cn("shrink-0", size === "sm" ? "size-3" : "size-3.5", t.text)} strokeWidth={2.25} />}
      {labelText != null && <span className="text-muted-foreground">{labelText}</span>}
      <span className="font-medium tabular-nums">{value}</span>
    </span>
  );
}
