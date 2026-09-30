"use client";

/**
 * The inbox's left column: items in groups (Blocking a run, Approvals, Ready to start, FYI) with
 * counts. Each row is a button that selects the item; the page handles J/K and Enter.
 */
import type { ReactNode } from "react";
import { CountBadge } from "@/components/common";
import type { InboxItem } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { StageChip } from "../project-list/StageChip";
import { GroupIcon, INBOX_GROUPS, inboxGroupMeta, ItemIcon, itemGroup, itemSince, itemText, RunLine, WaitingFor, type InboxGroup } from "./bits";

export interface InboxListProps {
  items: InboxItem[];
  selectedId?: string;
  onSelect: (item: InboxItem) => void;
  className?: string;
}


export function inboxRowDomId(id: string): string {
  return `inbox-row-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function Row({ item, selected, onSelect }: { item: InboxItem; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      id={inboxRowDomId(item.id)}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "group flex w-full min-w-0 items-start gap-3 rounded-[18px] px-3 py-3 text-left transition-[background-color,box-shadow] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected ? "bg-(--chip-bg) shadow-chip" : "hover:bg-foreground/[0.035] dark:hover:bg-foreground/[0.05]",
      )}
    >
      <ItemIcon item={item} className="mt-0.5" />
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-heading">{item.projectName}</span>
          <span className="flex-1" />
          <WaitingFor since={itemSince(item)} className="text-xs text-muted-foreground" />
        </span>
        {/* The stage (full title) sits with the run line, so it never squeezes the project name. */}
        <span className="flex min-w-0 items-center gap-1.5">
          <StageChip stage={item.stage} />
          {item.kind === "human" ? <RunLine item={item} className="min-w-0 flex-1" /> : null}
        </span>
        <span className={cn("line-clamp-2 text-[13px] leading-5", selected ? "text-foreground" : "text-foreground/85")}>{itemText(item)}</span>
      </span>
    </button>
  );
}

export function InboxList({ items, selectedId, onSelect, className }: InboxListProps) {
  const groups = INBOX_GROUPS.map((group) => ({ group, rows: items.filter((i) => itemGroup(i) === group) })).filter((g) => g.rows.length > 0);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {groups.map(({ group, rows }) => (
        <GroupSection key={group} group={group} count={rows.length}>
          {rows.map((item) => (
            <li key={item.id}>
              <Row item={item} selected={item.id === selectedId} onSelect={() => onSelect(item)} />
            </li>
          ))}
        </GroupSection>
      ))}
    </div>
  );
}

function GroupSection({ group, count, children }: { group: InboxGroup; count: number; children: ReactNode }) {
  const meta = inboxGroupMeta(group);
  const headingId = `inbox-group-${group}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <h2 id={headingId} className="flex items-center gap-2 px-3 pt-3 pb-2 text-[13px] font-medium text-muted-foreground">
        <GroupIcon group={group} />
        {meta.label}
        <CountBadge n={count} tone={meta.tone} hideZero={false} label={`${count} ${meta.label}`} />
      </h2>
      <ul className="flex flex-col gap-1">{children}</ul>
    </section>
  );
}
