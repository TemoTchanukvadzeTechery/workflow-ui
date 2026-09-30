"use client";

/** Home "Needs your attention": how many things wait on a person, and the top five of them. */
import { ArrowRight, CircleCheck } from "lucide-react";
import Link from "next/link";
import { CountBadge, EmptyState, SectionCard } from "@/components/common";
import type { InboxItem } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { AttentionRow } from "../inbox/AttentionRow";

export interface AttentionCardProps {
  /** Items waiting on people (blocking a run + awaiting approval). */
  count: number;
  items: InboxItem[];
  className?: string;
}

export function AttentionCard({ count, items, className }: AttentionCardProps) {
  const top = items.slice(0, 5);
  return (
    <SectionCard
      kicker="For you"
      title={
        <span className="inline-flex items-center gap-2">
          Needs your attention
          <CountBadge n={count} tone="attention" hideZero={false} label={`${count} items waiting on people`} />
        </span>
      }
      description={count === 0 ? "Nothing waits on a person right now." : "Runs paused for an answer, and gates waiting for approval."}
      className={cn("@container", className)}
      bodyClassName="flex flex-col"
    >
      {top.length === 0 ? (
        <EmptyState size="sm" icon={CircleCheck} title="Nothing needs you right now" body="Agents keep working; new questions show up here and in the Inbox." className="flex-1" />
      ) : (
        <ul className="-mx-3 flex flex-col">
          {top.map((item) => (
            <li key={item.id}>
              <AttentionRow item={item} />
            </li>
          ))}
        </ul>
      )}
      <Link href="/inbox" className="mt-auto inline-flex items-center gap-1 self-start rounded-full pt-3 text-[13px] font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        Open the inbox
        <ArrowRight aria-hidden className="size-3.5" />
      </Link>
    </SectionCard>
  );
}
