"use client";

/**
 * "Needs your attention" for one project: requests holding a run first, then approvals, then
 * things ready to start, then FYI.
 * Human requests can be answered right here (collapsed by default); every row also links to the
 * stage or task page where the request lives.
 */
import { ChevronDown, CircleCheck, MessageSquareReply } from "lucide-react";
import { useState } from "react";
import { CountBadge, EmptyState, SectionCard } from "@/components/common";
import { HumanRequestCard } from "@/components/hitl";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { InboxItem, ProjectBundle } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { AttentionRow } from "../inbox/AttentionRow";
import { orderByGroup } from "../inbox/bits";

type HumanItem = Extract<InboxItem, { kind: "human" }>;

function HumanAttention({ item, projectId }: { item: HumanItem; projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex min-w-0 flex-col @lg:flex-row @lg:items-start @lg:gap-1">
        <AttentionRow item={item} showProject={false} className="min-w-0 flex-1" />
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="-mt-1.5 mb-1 ml-11 shrink-0 self-start rounded-full text-primary @lg:mt-2 @lg:mb-0 @lg:ml-0">
            <MessageSquareReply aria-hidden />
            <span>
              {open ? "Hide" : "Answer here"}
              <span className="sr-only"> ({item.entry.id})</span>
            </span>
            <ChevronDown aria-hidden className={cn("transition-transform duration-150", open && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="px-3 pb-3">
        {open ? (
          <HumanRequestCard runId={item.entry.runId} request={item.entry} workflow={item.entry.workflow} projectId={projectId} compact onAnswered={() => setOpen(false)} />
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ProjectAttention({ bundle, className }: { bundle: ProjectBundle; className?: string }) {
  const items = orderByGroup(bundle.inbox);
  const waiting = items.filter((i) => i.tier !== "fyi").length;
  return (
    <SectionCard
      kicker="This project"
      title={
        <span className="inline-flex items-center gap-2">
          Needs your attention
          <CountBadge n={waiting} tone="attention" hideZero={false} label={`${waiting} items waiting on people`} />
        </span>
      }
      description={waiting === 0 ? "Nothing on this project waits on a person." : "Answer requests here, or open them where they live."}
      className={cn("@container", className)}
    >
      {items.length === 0 ? (
        <EmptyState size="sm" icon={CircleCheck} title="Nothing needs you right now" body="Agents keep working; new questions show up here, in the stage and in the Inbox." />
      ) : (
        <ul className="-mx-3 flex flex-col">
          {items.map((item) => (
            <li key={item.id}>{item.kind === "human" ? <HumanAttention item={item} projectId={bundle.project.id} /> : <AttentionRow item={item} showProject={false} />}</li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
