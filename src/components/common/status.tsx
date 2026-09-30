import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { statusMeta, type StatusRef, type Tone } from "@/lib/weft/labels";
import { toneClasses } from "./tone";

export interface StatusDotProps {
  tone: Tone;
  /** Live state: an expanding ring (disabled under prefers-reduced-motion). */
  pulse?: boolean;
  size?: "sm" | "md" | "lg";
  /** Accessible name. Without it the dot is decorative (pair it with visible text). */
  label?: string;
  className?: string;
}

const DOT_SIZE = { sm: "size-1.5", md: "size-2", lg: "size-2.5" } as const;

/** A small solid dot in a status tone; pulses for live states. Never the only status signal. */
export function StatusDot({ tone, pulse, size = "md", label, className }: StatusDotProps) {
  const t = toneClasses(tone);
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      className={cn("relative inline-block shrink-0 rounded-full", DOT_SIZE[size], t.solid, t.solidText, pulse && "pulse-dot", className)}
    />
  );
}

export interface StatusPillProps {
  /** Resolve label, tone, icon and pulse from labels.ts, e.g. `{ kind: "run", value: "executing" }`. */
  status?: StatusRef;
  /** Explicit tone; overrides `status`. A StatusMeta can be spread in: `<StatusPill {...runStatusMeta(s)} />`. */
  tone?: Tone;
  label?: ReactNode;
  /** Leading icon; `null` hides it. Ignored while `pulse` is on (a pulsing dot replaces it). */
  icon?: LucideIcon | null;
  pulse?: boolean;
  size?: "sm" | "md";
  /**
   * soft = tinted pill (default); outline = hairline border, no fill; plain = icon + text only;
   * chip = the white floating chip (STYLE.md 3) with a tone-colored icon and ink label, for hero
   * deltas and labels floating over charts.
   */
  variant?: "soft" | "outline" | "plain" | "chip";
  className?: string;
  title?: string;
}

/** Status pill: icon (or pulsing dot) + label, tinted by tone; never color alone (STYLE.md 3). */
export function StatusPill({ status, tone, label, icon, pulse, size = "md", variant = "soft", className, title }: StatusPillProps) {
  const meta = status ? statusMeta(status) : undefined;
  const resolvedTone: Tone = tone ?? meta?.tone ?? "neutral";
  const resolvedLabel = label ?? meta?.label;
  const Icon = icon === null ? null : (icon ?? meta?.icon ?? null);
  const live = pulse ?? meta?.pulse ?? false;
  const t = toneClasses(resolvedTone);

  return (
    <span
      data-slot="status-pill"
      data-tone={resolvedTone}
      title={title}
      className={cn(
        variant === "chip"
          ? cn("chip-float font-medium", t.glow, size === "sm" && "h-6! gap-1! px-2! text-xs!")
          : cn(
              "inline-flex w-fit shrink-0 items-center rounded-full font-medium whitespace-nowrap",
              size === "sm" ? "h-6 gap-1 px-2 text-xs leading-none" : "h-7 gap-1.5 px-2.5 text-[13px] leading-none",
              variant === "soft" && t.bg,
              variant === "outline" && ["border", t.border],
              variant === "plain" && "h-auto px-0",
              t.text,
            ),
        className,
      )}
    >
      {live ? (
        <StatusDot tone={resolvedTone} pulse size={size === "sm" ? "sm" : "md"} className="mx-0.5" />
      ) : Icon ? (
        <Icon aria-hidden className={cn("shrink-0", size === "sm" ? "size-3" : "size-3.5", variant === "chip" && t.text)} strokeWidth={2.25} />
      ) : null}
      {resolvedLabel != null && <span className="truncate">{resolvedLabel}</span>}
    </span>
  );
}

export interface CountBadgeProps {
  n: number;
  tone?: Tone | "primary";
  /** Hide the badge at zero (default true). */
  hideZero?: boolean;
  className?: string;
  label?: string;
}

/** Small tabular count, e.g. the Inbox badge or a tab count. */
export function CountBadge({ n, tone = "neutral", hideZero = true, className, label }: CountBadgeProps) {
  if (hideZero && n === 0) return null;
  const cls = tone === "primary" ? "bg-primary text-primary-foreground" : cn(toneClasses(tone).bg, toneClasses(tone).text);
  return (
    <span
      aria-label={label}
      className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-semibold tabular-nums", cls, className)}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}
