"use client";

/** Home "Needs your attention": how many things wait on a person, and the first eight of them. */
import { CircleCheck } from "lucide-react";
import { CountBadge, EmptyState, SectionCard } from "@/components/common";
import type { InboxItem } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { AttentionRow } from "../inbox/AttentionRow";
import { CardMenu } from "./CardMenu";

export interface AttentionCardProps {
  /** Items waiting on people (blocking a run + awaiting approval). */
  count: number;
  items: InboxItem[];
  className?: string;
}

export function AttentionCard({ count, items, className }: AttentionCardProps) {
  const top = items.slice(0, 8);
  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2.5">
          Needs your attention
          <CountBadge n={count} tone="attention" hideZero={false} label={`${count} items waiting on people`} className="h-6 min-w-6 text-xs" />
        </span>
      }
      cardMenu={<CardMenu href="/inbox" label="Open the inbox" />}
      className={cn("@container", className)}
      bodyClassName="flex flex-col"
    >
      {top.length === 0 ? (
        <EmptyState size="sm" icon={CircleCheck} title="Nothing needs you right now" body="Agents keep working; new questions show up here and in the Inbox." className="flex-1" />
      ) : (
        <ul className="-mx-3 grid gap-x-3 gap-y-1 @3xl:grid-cols-2">
          {top.map((item) => (
            <li key={item.id} className="min-w-0">
              <AttentionRow item={item} />
            </li>
          ))}
        </ul>
      )}
      {count > top.length ? (
        <p className="mt-3 text-[13px] text-muted-foreground">
          {count - top.length} more in the Inbox.
        </p>
      ) : null}
    </SectionCard>
  );
}
