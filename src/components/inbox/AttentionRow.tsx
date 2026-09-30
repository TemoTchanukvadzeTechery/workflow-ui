"use client";

/** A compact "needs your attention" row: icon, project, waiting time, the question or title, then the stage and run. */
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { InboxItem } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { StageChip } from "../project-list/StageChip";
import { ItemIcon, itemKindLabel, itemSince, itemText, RunLine, WaitingFor } from "./bits";

export interface AttentionRowProps {
  item: InboxItem;
  /** Show the project name (off inside a project page). */
  showProject?: boolean;
  className?: string;
}

export function AttentionRow({ item, showProject = true, className }: AttentionRowProps) {
  return (
    <Link
      href={item.href}
      className={cn(
        "group flex min-w-0 items-start gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      <ItemIcon item={item} className="mt-0.5" />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex min-w-0 items-center gap-1.5">
          {showProject ? <span className="min-w-0 truncate text-xs font-medium text-foreground">{item.projectName}</span> : <span className="text-xs font-medium text-foreground">{itemKindLabel(item)}</span>}
          <span className="flex-1" />
          <WaitingFor since={itemSince(item)} className="text-[11px] text-muted-foreground" />
        </span>
        <span className="line-clamp-2 text-[13px] leading-snug text-foreground/90">{itemText(item)}</span>
        {/* The stage (full title) sits with the run line, so it never squeezes the project name. */}
        <span className="flex min-w-0 items-center gap-1.5">
          <StageChip stage={item.stage} />
          {item.kind === "human" ? <RunLine item={item} className="min-w-0 flex-1" /> : null}
        </span>
      </span>
      <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground/60 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-foreground" />
    </Link>
  );
}
