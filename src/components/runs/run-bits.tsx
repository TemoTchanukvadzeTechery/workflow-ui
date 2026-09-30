"use client";

/** Small shared pieces of the run inspector: workflow name + real/mock badge, run context links, status groups. */
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { StageIcon } from "@/components/common";
import { stageHref } from "@/hooks/use-stage-params";
import { stageDef } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import type { RunStatus } from "@/lib/weft/types";
import type { RunIndexEntry } from "./run-index-types";

/** po-brd and architect-aad exist in po-workspace today; the rest are SPEC mocks. */
export const REAL_WORKFLOWS: readonly string[] = ["po-brd", "architect-aad"];
export const isRealWorkflow = (w: string) => REAL_WORKFLOWS.includes(w);

export type RunStatusGroup = "active" | "needs_input" | "done" | "failed";

export const STATUS_GROUPS: ReadonlyArray<{ id: RunStatusGroup; label: string; hint: string }> = [
  { id: "active", label: "Active", hint: "Planning, running, integrating or verifying" },
  { id: "needs_input", label: "Needs input", hint: "Waiting for a person to answer" },
  { id: "done", label: "Done", hint: "Completed" },
  { id: "failed", label: "Failed", hint: "Failed or cancelled" },
];

export function statusGroup(s: RunStatus): RunStatusGroup {
  if (s === "waiting_for_human") return "needs_input";
  if (s === "complete") return "done";
  if (s === "failed" || s === "cancelled") return "failed";
  return "active";
}

export function WorkflowBadge({ workflow, className }: { workflow: string; className?: string }) {
  const real = isRealWorkflow(workflow);
  return (
    <span
      title={real ? "Real weft workflow (po-workspace)" : "Mock workflow shaped like a future weft workflow"}
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full px-2 text-xs font-medium capitalize",
        real ? "bg-status-running-bg text-status-running-fg" : "bg-status-neutral-bg text-status-neutral-fg",
        className,
      )}
    >
      {real ? "real" : "mock"}
    </span>
  );
}

/** `badges="real"` marks only the real workflows (lists where a page note already says the rest are mocks). */
export function WorkflowName({ workflow, href, badges = "all", className }: { workflow: string; href?: string; badges?: "all" | "real"; className?: string }) {
  const name = <span className="truncate font-mono text-[13px] font-medium text-foreground">{workflow}</span>;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {href ? (
        <Link href={href} className="min-w-0 truncate underline-offset-2 hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
          {name}
        </Link>
      ) : (
        name
      )}
      {badges === "all" || isRealWorkflow(workflow) ? <WorkflowBadge workflow={workflow} /> : null}
    </span>
  );
}

/**
 * "Agreement Reporting · Implementation · T-4" on one line (the project name truncates), with
 * links to the project, the stage page and the task. `wrap` lets it break onto more lines.
 */
export function RunContext({ entry, className, showProject = true, wrap, stacked }: { entry: RunIndexEntry | undefined; className?: string; showProject?: boolean; wrap?: boolean; stacked?: boolean }) {
  if (!entry) return <span className={cn("text-[13px] text-muted-foreground", className)}>Not linked to a project</span>;
  const def = stageDef(entry.stage);
  const link = "underline-offset-2 hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";
  const sep = <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />;
  if (stacked) {
    return (
      <span className={cn("flex min-w-0 flex-col gap-0.5", className)}>
        {showProject && (
          <Link href={`/projects/${entry.projectId}`} className={cn(link, "block min-w-0 truncate text-[13px] leading-5 font-medium text-foreground")} title={entry.projectName}>
            {entry.projectName}
          </Link>
        )}
        <RunContext entry={entry} showProject={false} className="text-xs" />
      </span>
    );
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-x-1 gap-y-0.5 text-[13px]", wrap ? "flex-wrap" : "max-w-full whitespace-nowrap", className)}>
      {showProject && (
        <>
          <Link href={`/projects/${entry.projectId}`} className={cn(link, "min-w-0 truncate font-medium text-foreground")} title={entry.projectName}>
            {entry.projectName}
          </Link>
          {sep}
        </>
      )}
      <Link href={stageHref(entry.projectId, entry.stage)} className={cn(link, "inline-flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground")}>
        <StageIcon stage={entry.stage} className="size-3.5 shrink-0" />
        {def.title}
      </Link>
      {entry.taskId && (
        <>
          {sep}
          <Link href={`/projects/${entry.projectId}/tasks/${entry.taskId}`} className={cn(link, "shrink-0 font-mono text-xs text-foreground")} title={entry.taskTitle}>
            {entry.taskId}
          </Link>
        </>
      )}
    </span>
  );
}
