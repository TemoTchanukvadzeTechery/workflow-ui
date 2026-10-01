"use client";

/**
 * One check group on the Health tab (plan §3): the group's name and what it covers, the points
 * it earns of what it could, and its checks as collapsible rows. The panel owns which rows are
 * open, so a `#check-<id>` hash can open one.
 */
import { SectionCard } from "@/components/common";
import type { MemoryHealthCheck, MemoryHealthCheckId, MemoryHealthGroup } from "@/lib/memory/types";
import { formatPoints, HEALTH_GROUP_META } from "./check-meta";
import { CheckRow } from "./check-row";

export interface CheckGroupCardProps {
  group: MemoryHealthGroup;
  /** The group's checks, catalogue order. */
  checks: MemoryHealthCheck[];
  isOpen: (id: MemoryHealthCheckId) => boolean;
  onOpenChange: (id: MemoryHealthCheckId, open: boolean) => void;
  className?: string;
}

export function CheckGroupCard({ group, checks, isOpen, onOpenChange, className }: CheckGroupCardProps) {
  const meta = HEALTH_GROUP_META[group.id];
  const Icon = meta.icon;
  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2.5">
          <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          {meta.label}
        </span>
      }
      description={meta.blurb}
      actions={
        <span className="pt-1 text-[13px] leading-5 whitespace-nowrap text-muted-foreground tabular-nums">
          {group.possible === 0 ? (
            "Not checked"
          ) : (
            <>
              <span className="text-[15px] text-heading">{formatPoints(group.earned)}</span> of {group.possible} points
            </>
          )}
        </span>
      }
      density="dense"
      className={className}
      bodyClassName="pt-2!"
    >
      <ul className="-mx-3 flex flex-col gap-0.5" aria-label={`${meta.label} checks`}>
        {checks.map((check) => (
          <CheckRow key={check.id} check={check} open={isOpen(check.id)} onOpenChange={(open) => onOpenChange(check.id, open)} />
        ))}
      </ul>
    </SectionCard>
  );
}
