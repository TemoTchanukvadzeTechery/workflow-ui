"use client";

/**
 * Project health as a pill that can say why. When a project is not on track the pill is a button
 * opening the reason (the server's healthReason, else the rule that makes a project at risk or
 * off track), so it works on touch as well as hover. `interactive={false}` for places inside a
 * link (project cards), where the reason is shown as text instead.
 */
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Health } from "@/lib/delivery/types";
import { healthMeta } from "@/lib/weft/labels";
import { cn } from "@/lib/utils";
import { StatusPill } from "./status";

/** SPEC 4.3's health rules, for when the server gives no reason. */
const HEALTH_RULE: Record<Health, string> = {
  on_track: "No failed runs, escalated tasks, blocking questions or requests waiting over 24 h.",
  at_risk: "Blocking questions in an accepted document, or a request waiting over 24 h.",
  off_track: "A run failed without a newer success, or a task is escalated.",
};

/** Why a project has this health: the reason when known, else the rule. */
export function healthReasonText(health: Health, reason?: string): string {
  return reason?.trim() || HEALTH_RULE[health];
}

export interface HealthPillProps {
  health: Health;
  /** ProjectSummary.healthReason / ProjectBundle.healthReason. */
  reason?: string;
  size?: "sm" | "md";
  variant?: "soft" | "plain";
  interactive?: boolean;
  className?: string;
}

export function HealthPill({ health, reason, size = "sm", variant = "soft", interactive = true, className }: HealthPillProps) {
  const label = healthMeta(health).label;
  const why = healthReasonText(health, reason);
  if (health === "on_track" || !interactive) {
    return <StatusPill status={{ kind: "health", value: health }} size={size} variant={variant} className={className} title={health === "on_track" ? undefined : `${label}: ${why}`} />;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`${label}: ${why}`}
          aria-label={`${label}. Why?`}
          className={cn("inline-flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", variant === "soft" && "hover:brightness-95 dark:hover:brightness-125", className)}
        >
          <StatusPill status={{ kind: "health", value: health }} size={size} variant={variant} className="cursor-pointer underline-offset-2 hover:underline" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-72 space-y-1 p-3 text-[13px] leading-5">
        <p className="font-medium text-foreground">{label}</p>
        <p className="text-muted-foreground">{why}</p>
      </PopoverContent>
    </Popover>
  );
}
