"use client";

/**
 * Small presentational pieces shared by hitl/, docs/, stage/ and projects/, built on the common
 * design system (src/components/common, src/lib/weft/labels.ts) so status tones come from the
 * --status-<tone>-fg/-bg tokens and every pill has an icon and a label, never color alone.
 */
import { CircleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { actorText, Kicker as CommonKicker, StatusPill } from "@/components/common";
import { toneClasses } from "@/components/common/tone";
import { useNow } from "@/hooks/use-now";
import type { Actor, StageStatus } from "@/lib/delivery/types";
import { formatRelative } from "@/lib/format";
import { stageStatusMeta, type StatusMeta, type Tone } from "@/lib/weft/labels";
import { cn } from "@/lib/utils";

export type { Tone };

/** Soft pill colors (text + tinted background) per tone. */
export const TONE_CLASS: Record<Tone, string> = {
  running: `${toneClasses("running").text} ${toneClasses("running").bg}`,
  attention: `${toneClasses("attention").text} ${toneClasses("attention").bg}`,
  review: `${toneClasses("review").text} ${toneClasses("review").bg}`,
  success: `${toneClasses("success").text} ${toneClasses("success").bg}`,
  danger: `${toneClasses("danger").text} ${toneClasses("danger").bg}`,
  neutral: `${toneClasses("neutral").text} ${toneClasses("neutral").bg}`,
};

export function TonePill({ tone, icon, children, className, pulse }: { tone: Tone; icon?: LucideIcon; children: ReactNode; className?: string; pulse?: boolean }) {
  return <StatusPill tone={tone} icon={icon ?? null} pulse={pulse} label={children} className={className} />;
}

export const STAGE_STATUS_META: Record<StageStatus, StatusMeta> = {
  locked: stageStatusMeta("locked"),
  not_started: stageStatusMeta("not_started"),
  in_progress: stageStatusMeta("in_progress"),
  needs_input: stageStatusMeta("needs_input"),
  in_review: stageStatusMeta("in_review"),
  approved: stageStatusMeta("approved"),
  failed: stageStatusMeta("failed"),
};

export function StageStatusPill({ status, className }: { status: StageStatus; className?: string }) {
  return <StatusPill status={{ kind: "stage", value: status }} className={className} />;
}

export function MonoChip({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-5 shrink-0 items-center rounded-md bg-muted px-1.5 font-mono text-[11px] leading-none whitespace-nowrap text-muted-foreground", className)}>
      {children}
    </span>
  );
}

export const Kicker = CommonKicker;

/**
 * "3m ago" from the shared ticker (format.ts), or with `elapsed` the bare duration for
 * "Waiting 3m". The absolute time is in the title.
 */
export function TimeAgo({ at, prefix, suffix, elapsed, className }: { at: number; prefix?: string; suffix?: string; elapsed?: boolean; className?: string }) {
  const now = useNow(30_000);
  const rel = formatRelative(at, Math.max(now, at));
  const text = elapsed ? (rel === "just now" ? "<1m" : rel.replace(/ ago$/, "")) : rel;
  return (
    <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()} className={className} suppressHydrationWarning>
      {prefix}
      {text}
      {suffix}
    </time>
  );
}

/** A small inline notice (warning or info). Pass role="alert" only for errors. */
export function Notice({ tone = "attention", icon: Icon = CircleAlert, children, className, role }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string; role?: "alert" | "status" }) {
  return (
    <div role={role} className={cn("flex items-start gap-2 rounded-lg px-3 py-2 text-[13px]", TONE_CLASS[tone], className)}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** A human's name, "agent (model)" for agents, "policy" / "system" otherwise. */
export function actorName(actor: Actor | undefined): string {
  return actor ? actorText(actor) : "someone";
}
