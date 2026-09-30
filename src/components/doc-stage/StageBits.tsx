"use client";

/**
 * Small pieces the two document stages share: the page skeleton shown until the project bundle
 * loads, and the "waiting on you in another sub-step" notice.
 */
import { ArrowRight, Hourglass } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function StageSkeleton() {
  return (
    <div className="@container/stage flex flex-col gap-5" aria-busy="true" aria-label="Loading the stage">
      <div className="space-y-3">
        <Skeleton className="h-12 w-[32rem] max-w-full rounded-[14px]" />
        <div className="flex gap-2">
          <Skeleton className="h-[30px] w-40 rounded-full" />
          <Skeleton className="h-[30px] w-28 rounded-full" />
        </div>
        <Skeleton className="mt-2 h-11 w-[28rem] max-w-full rounded-[16px]" />
      </div>
      <div className="grid gap-5 @4xl/stage:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <div className="card-surface space-y-3 rounded-2xl p-5">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
          <div className="card-surface space-y-3 rounded-2xl p-5">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
        <div className="card-surface space-y-3 rounded-2xl p-4">
          <Skeleton className="h-9 w-full rounded-[12px]" />
          <Skeleton className="h-40 w-full rounded-[20px]" />
        </div>
      </div>
    </div>
  );
}

export interface WaitingElsewhereProps {
  workflow: string;
  question: string;
  stepLabel: string;
  onGo: () => void;
}

/** "po-brd is waiting on you in Discovery" with a jump, when the open request is on another sub-step. */
export function WaitingElsewhere({ workflow, question, stepLabel, onGo }: WaitingElsewhereProps) {
  return (
    <div role="status" className="flex flex-col gap-3 rounded-[20px] bg-status-attention-bg px-4 py-3 text-status-attention-fg @xl/stage:flex-row @xl/stage:items-center @xl/stage:py-2.5 @xl/stage:pr-2.5">
      <Hourglass aria-hidden className="hidden size-4 shrink-0 @xl/stage:block" />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-medium">
          <span className="font-mono">{workflow}</span> is waiting on you in {stepLabel}.
        </span>{" "}
        <span className="line-clamp-1 opacity-90">{question}</span>
      </p>
      <Button className="w-fit" onClick={onGo}>
        Go to {stepLabel}
        <ArrowRight aria-hidden />
      </Button>
    </div>
  );
}

/** "Continue to Architecture" in the stage header once the gate is approved. */
export function NextStageLink({ projectId, stage, title, className }: { projectId: string; stage: string; title: string; className?: string }) {
  return (
    <Button asChild className={className}>
      <Link href={`/projects/${encodeURIComponent(projectId)}/${stage}`}>
        Continue to {title}
        <ArrowRight aria-hidden />
      </Link>
    </Button>
  );
}
