"use client";

/**
 * Inline QA review drawer: the task's evidence gallery, then the pending qa:review request card
 * (verdict: Ready for PO review / Bugs found / Blocked). Without a pending request it is an
 * evidence viewer with the recorded verdict and, while QA is open, Re-test (a new qa-verify run
 * whose evidence supersedes this one). The task page carries the same review at
 * /tasks/<id>?request=<runId>:<hId>.
 */
import { ArrowDown, ExternalLink, RefreshCw } from "lucide-react";
import Link from "next/link";
import { actorText, RelativeTime, StatusPill } from "@/components/common";
import { EvidenceGallery } from "@/components/evidence";
import { HumanRequestCard, requestDomId } from "@/components/hitl";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useStartQa } from "@/lib/api/queries";
import type { DeliveryTask, ProjectBundle } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { qaStatusMeta } from "@/lib/weft/labels";
import { canRetest, pendingQaReview, qaBlockedReason, taskHref, taskKey } from "./shared";

/** The recorded verdict (or why the task is blocked) and, while QA is open, Re-test. */
function VerdictAndRetest({ projectId, bundle, task, readOnly }: { projectId: string; bundle: ProjectBundle; task: DeliveryTask; readOnly: boolean }) {
  const startQa = useStartQa(projectId);
  const blocked = qaBlockedReason(bundle, task);
  // The last verdict stands only until a new run starts; while testing, the header pill says so.
  const review = task.qa.status === "certified" || task.qa.status === "bugs_found" ? task.qa.review : undefined;
  const retest = !readOnly && canRetest(task);
  if (!blocked && !review && !retest) return null;
  return (
    <section aria-label="QA verdict" className={cn("space-y-2.5 rounded-[16px] px-4 py-3 text-sm", blocked ? "bg-status-attention-bg" : "bg-well")}>
      {blocked ? (
        <p>
          <span className="font-medium text-status-attention-fg">Blocked: {blocked.text}</span>
          {blocked.review ? (
            <span className="text-muted-foreground">
              {" "}
              · {actorText(blocked.review.by)} <RelativeTime at={blocked.review.at} />
            </span>
          ) : null}
        </p>
      ) : review ? (
        <p className="text-muted-foreground">
          QA verdict recorded by {actorText(review.by)} <RelativeTime at={review.at} />
          {review.comment ? <>: &ldquo;{review.comment}&rdquo;</> : "."}
        </p>
      ) : null}
      {retest ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button type="button" size="sm" variant="secondary" className="bg-raised shadow-(--raised-shadow)" onClick={() => startQa.mutate({ taskIds: [task.id] })} disabled={startQa.isPending}>
            <RefreshCw aria-hidden className={cn(startQa.isPending && "animate-spin motion-reduce:animate-none")} />
            {startQa.isPending ? "Starting…" : "Re-test"}
          </Button>
          <span className="text-[13px] text-muted-foreground">
            {blocked ? "Once the blocker is resolved, run" : "Runs"} qa-verify again on {taskKey(task)}: new evidence supersedes this run&rsquo;s and QA reviews it again.
          </span>
        </div>
      ) : null}
    </section>
  );
}

export interface ReviewTarget {
  taskId: string;
  evidenceId?: string;
}

export function ReviewSheet({ projectId, bundle, target, onClose }: { projectId: string; bundle: ProjectBundle; target: ReviewTarget | null; onClose: () => void }) {
  const task = target ? bundle.tasks.find((t) => t.id === target.taskId) : undefined;
  const pending = task ? pendingQaReview(bundle, task) : undefined;
  const readOnly = bundle.project.done || bundle.stages.qa.status === "approved" || bundle.stages.qa.status === "locked";

  return (
    <Sheet open={!!task} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl data-[side=right]:lg:max-w-5xl">
        {task ? (
          <>
            <SheetHeader className="gap-2 border-b border-rule px-5 pt-5 pb-4 pr-14 sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-medium">{taskKey(task)}</span>
                <span className="font-mono text-xs text-muted-foreground">{task.id}</span>
                <StatusPill {...qaStatusMeta(task.qa.status)} size="sm" />
              </div>
              <SheetTitle className="text-[22px] leading-7 font-normal tracking-[-0.02em] text-heading">{task.title}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                <span className="font-mono">{task.repo}</span>
                <Link href={taskHref(projectId, task.id, pending)} className="inline-flex items-center gap-1 text-primary hover:underline">
                  Open task page
                  <ExternalLink aria-hidden className="size-3" />
                </Link>
              </SheetDescription>
              {pending && !readOnly ? (
                <Button
                  type="button"
                  size="sm"
                  className="mt-1 w-fit"
                  onClick={() => document.getElementById(requestDomId(pending.runId, pending.requestId))?.scrollIntoView({ behavior: "smooth", block: "start" })}
                >
                  <ArrowDown aria-hidden />
                  Go to the verdict
                </Button>
              ) : null}
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
              {pending && !readOnly ? null : <VerdictAndRetest projectId={projectId} bundle={bundle} task={task} readOnly={readOnly} />}
              <EvidenceGallery projectId={projectId} task={task} evidence={bundle.evidence} focusEvidenceId={target?.evidenceId} />
              {pending && !readOnly ? (
                <section aria-label="QA verdict" className="space-y-2">
                  <h3 className="text-[15px] font-medium text-heading">Your verdict</h3>
                  <HumanRequestCard runId={pending.runId} request={pending.entry} workflow="qa-verify" projectId={projectId} onAnswered={onClose} />
                </section>
              ) : null}
            </div>
          </>
        ) : (
          <SheetTitle className="sr-only">QA review</SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  );
}
