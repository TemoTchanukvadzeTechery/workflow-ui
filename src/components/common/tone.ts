/**
 * Static Tailwind class names per status tone. Tailwind only generates classes it can see
 * literally, so components look tones up here instead of building `text-status-${tone}-fg`.
 */
import type { Tone } from "@/lib/weft/labels";

export interface ToneClasses {
  /** Foreground text/icon color (AA on cards and on the soft background). */
  text: string;
  /** Soft tinted background (pills, highlighted rows). */
  bg: string;
  /** Solid fill in the tone's saturated color (dots, done segments, chart marks). */
  solid: string;
  /** The saturated color as a text color, so `currentColor` (pulse rings, SVG fills) matches `solid`. */
  solidText: string;
  /** Striped fill (STYLE 5): the `stripes` utility with --c set to the tone's solid color. */
  stripe: string;
  /** Tints a `chip-float` glow with the tone. */
  glow: string;
  /** Hairline border in the tone. */
  border: string;
  /** Focus/selection ring in the tone. */
  ring: string;
}

export const TONE_CLASSES: Record<Tone, ToneClasses> = {
  running: {
    text: "text-status-running-fg",
    bg: "bg-status-running-bg",
    solid: "bg-status-running-solid",
    solidText: "text-status-running-solid",
    stripe: "stripes [--c:var(--status-running-solid)]",
    glow: "[--chip-glow:var(--status-running-solid)]",
    border: "border-status-running-fg/30",
    ring: "ring-status-running-fg/30",
  },
  attention: {
    text: "text-status-attention-fg",
    bg: "bg-status-attention-bg",
    solid: "bg-status-attention-solid",
    solidText: "text-status-attention-solid",
    stripe: "stripes [--c:var(--status-attention-solid)]",
    glow: "[--chip-glow:var(--status-attention-solid)]",
    border: "border-status-attention-fg/30",
    ring: "ring-status-attention-fg/30",
  },
  review: {
    text: "text-status-review-fg",
    bg: "bg-status-review-bg",
    solid: "bg-status-review-solid",
    solidText: "text-status-review-solid",
    stripe: "stripes [--c:var(--status-review-solid)]",
    glow: "[--chip-glow:var(--status-review-solid)]",
    border: "border-status-review-fg/30",
    ring: "ring-status-review-fg/30",
  },
  success: {
    text: "text-status-success-fg",
    bg: "bg-status-success-bg",
    solid: "bg-status-success-solid",
    solidText: "text-status-success-solid",
    stripe: "stripes [--c:var(--status-success-solid)]",
    glow: "[--chip-glow:var(--status-success-solid)]",
    border: "border-status-success-fg/30",
    ring: "ring-status-success-fg/30",
  },
  danger: {
    text: "text-status-danger-fg",
    bg: "bg-status-danger-bg",
    solid: "bg-status-danger-solid",
    solidText: "text-status-danger-solid",
    stripe: "stripes [--c:var(--status-danger-solid)]",
    glow: "[--chip-glow:var(--status-danger-solid)]",
    border: "border-status-danger-fg/30",
    ring: "ring-status-danger-fg/30",
  },
  neutral: {
    text: "text-status-neutral-fg",
    bg: "bg-status-neutral-bg",
    solid: "bg-status-neutral-solid",
    solidText: "text-status-neutral-solid",
    stripe: "stripes [--c:var(--status-neutral-solid)]",
    glow: "[--chip-glow:var(--status-neutral-solid)]",
    border: "border-status-neutral-fg/30",
    ring: "ring-status-neutral-fg/30",
  },
};

export const toneClasses = (tone: Tone): ToneClasses => TONE_CLASSES[tone] ?? TONE_CLASSES.neutral;
