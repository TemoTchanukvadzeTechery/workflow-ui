/**
 * The band above the timeline when the vault has uncommitted changes (plan §4). Uncommitted note
 * files block po-brd and architect-aad (their preflight refuses to start: the drafting agent reads
 * notes from a worktree of the last commit), so that case is an attention panel saying so, with
 * the change pills and "View changes". Changes to other vault files only (README, templates,
 * Obsidian settings) block nothing and read as a quiet note. Hook-free; the timeline panel owns the sheet.
 */
import { FileDiff, GitCommitHorizontal, TriangleAlert } from "lucide-react";
import { RelativeTime } from "@/components/common";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/format";
import type { MemoryTimelineEvent } from "@/lib/memory/types";
import { cn } from "@/lib/utils";
import { ChangeChips } from "./change-chips";
import { blocksRuns, fileCount } from "./event-headline";

export interface UncommittedBandProps {
  /** The page-1 `working` event. */
  event: MemoryTimelineEvent;
  onViewChanges: () => void;
  className?: string;
}

export function UncommittedBand({ event, onViewChanges, className }: UncommittedBandProps) {
  const blocking = event.files.filter(blocksRuns).length;
  const files = fileCount(event.totals);
  const at = Date.parse(event.committedAt);
  return (
    <section
      role="status"
      aria-label="Uncommitted vault changes"
      className={cn("flex flex-col gap-3 rounded-[20px] px-5 py-4", blocking > 0 ? "bg-status-attention-bg" : "bg-well/70", className)}
    >
      <div className={cn("flex items-start gap-2.5 text-sm leading-5", blocking > 0 ? "text-status-attention-fg" : "text-foreground")}>
        {blocking > 0 ? (
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
        ) : (
          <GitCommitHorizontal aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
        )}
        <p className="min-w-0">
          {blocking > 0 ? (
            <>
              <span className="font-medium">{plural(blocking, "note has", "notes have")} uncommitted changes.</span> po-brd and architect-aad refuse to start until
              they are committed: their drafting agents read notes from the last commit. Commit <code className="font-mono text-[13px]">memory/</code> in the
              po-workspace (<code className="font-mono text-[13px]">git add memory &amp;&amp; git commit</code>), or discard the changes.
            </>
          ) : (
            <>
              <span className="font-medium">{plural(files, "vault file has", "vault files have")} uncommitted changes</span>{" "}
              <span className="text-muted-foreground">(no notes, so nothing is blocked).</span>
            </>
          )}{" "}
          {Number.isFinite(at) ? <RelativeTime at={at} prefix="Last edit" className="text-muted-foreground" /> : null}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:pl-6.5">
        <ChangeChips totals={event.totals} claimsAnalysed={event.claimsAnalysed} />
        <Button type="button" size="sm" variant="secondary" className="bg-raised shadow-(--raised-shadow)" onClick={onViewChanges}>
          <FileDiff aria-hidden />
          View changes
        </Button>
      </div>
    </section>
  );
}
