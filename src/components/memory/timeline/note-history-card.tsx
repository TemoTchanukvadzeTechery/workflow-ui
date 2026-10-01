"use client";

/**
 * The note page's History card (plan §4), in the rail between Connections and the outline: the
 * commits that touched this note, newest first, following renames back, with the uncommitted
 * change on top in the attention tone. Rows read Created / Edited / Renamed / Removed (or
 * "Signed off <project>"), with who, the short sha, when, the claim pills and a diff button that
 * opens the vault diff drawer on this note. Five rows, then "Show all".
 */
import { BadgeCheck, CircleDashed, FileDiff, FileMinus2, FilePen, FilePlus2, FileSymlink, GitBranch, History, PencilLine, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState, IdChip, RelativeTime, SectionCard, StatusPill, toneClasses } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemoryNoteHistory, useProjects } from "@/lib/api/queries";
import type { MemoryNoteHistoryEntry } from "@/lib/memory/types";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/weft/labels";
import { memoryViewHref } from "../use-memory-view";
import { ClaimChips } from "./change-chips";
import { CommitDiffSheet, type CommitDiffTarget } from "./commit-diff-sheet";
import { vaultLabel } from "./event-headline";

const INITIAL_ROWS = 5;

interface RowMeta {
  icon: LucideIcon;
  tone: Tone;
  /** What happened to the note. */
  label: string;
}

const STATUS_ROW: Record<MemoryNoteHistoryEntry["status"], RowMeta> = {
  A: { icon: FilePlus2, tone: "success", label: "Created" },
  M: { icon: FilePen, tone: "neutral", label: "Edited" },
  T: { icon: FilePen, tone: "neutral", label: "Type changed" },
  R: { icon: FileSymlink, tone: "review", label: "Renamed" },
  C: { icon: FilePlus2, tone: "success", label: "Copied" },
  D: { icon: FileMinus2, tone: "danger", label: "Removed" },
};

const UNCOMMITTED_LABEL: Partial<Record<MemoryNoteHistoryEntry["status"], string>> = {
  A: "Created, not committed yet",
  D: "Deleted, not committed yet",
};

function rowMeta(e: MemoryNoteHistoryEntry): RowMeta {
  if (e.kind === "uncommitted") return { icon: PencilLine, tone: "attention", label: UNCOMMITTED_LABEL[e.status] ?? "Edited, not committed yet" };
  if (e.kind === "signoff") return { icon: BadgeCheck, tone: "success", label: "Signed off" };
  const meta = STATUS_ROW[e.status];
  if ((e.status === "R" || e.status === "C") && e.oldPath) return { ...meta, label: `${meta.label} from ${vaultLabel(e.oldPath)}` };
  return meta;
}

function HistoryRow({ entry, projectLinked, onDiff }: { entry: MemoryNoteHistoryEntry; projectLinked: boolean; onDiff: () => void }) {
  const meta = rowMeta(entry);
  const tone = toneClasses(meta.tone);
  const Icon = meta.icon;
  const uncommitted = entry.kind === "uncommitted";
  const at = Date.parse(entry.committedAt);
  return (
    <li className={cn("flex gap-2.5 py-2.5", uncommitted && "-mx-2 my-1 rounded-[14px] bg-status-attention-bg px-2")}>
      <span aria-hidden className={cn("mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full", uncommitted ? "bg-(--chip-bg)" : tone.bg, tone.text)}>
        <Icon className="size-3.5" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm leading-5 break-words", uncommitted ? "font-medium text-status-attention-fg" : "text-heading")}>
          {meta.label}
          {entry.kind === "signoff" && entry.project ? (
            <>
              {" "}
              {projectLinked ? (
                <Link href={`/projects/${entry.project}`} className="font-medium text-primary underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none">
                  {entry.project}
                </Link>
              ) : (
                <span className="font-medium">{entry.project}</span>
              )}
              {entry.status === "A" ? <span className="text-muted-foreground"> · created</span> : null}
            </>
          ) : null}
        </p>
        {entry.kind === "commit" && entry.subject ? (
          <p className="truncate text-xs leading-5 text-muted-foreground" title={entry.subject}>
            {entry.subject}
          </p>
        ) : null}
        {/* Two short lines: the rail is too narrow for author · sha · time to wrap cleanly. */}
        <div className="mt-0.5 flex min-w-0 flex-col gap-1 text-xs leading-5 text-muted-foreground">
          {entry.author ? (
            <span className="truncate text-foreground" title={entry.author.email}>
              {entry.author.name}
            </span>
          ) : null}
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            {uncommitted ? null : (
              <>
                <IdChip id={entry.sha} size="sm">
                  {entry.shortSha}
                </IdChip>
                <span aria-hidden>·</span>
              </>
            )}
            <RelativeTime at={at} />
          </span>
        </div>
        {entry.claims ? (
          <ClaimChips counts={entry.claims} className="mt-1.5" />
        ) : (
          <StatusPill tone="neutral" icon={CircleDashed} label="Claims not analysed" size="sm" className="mt-1.5" title="The commit is too large, or git failed, so its claim changes were not counted." />
        )}
      </div>
      <button
        type="button"
        onClick={onDiff}
        aria-label={uncommitted ? "View the uncommitted diff of this note" : `View the diff of this note in ${entry.shortSha}`}
        title="View the diff"
        className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-heading focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <FileDiff aria-hidden className="size-4" />
      </button>
    </li>
  );
}

function HistorySkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading the note's history">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-2.5">
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3.5 w-48 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export interface NoteHistoryCardProps {
  /** `<type>/<slug>`. */
  noteId: string;
  className?: string;
}

export function NoteHistoryCard({ noteId, className }: NoteHistoryCardProps) {
  const history = useMemoryNoteHistory(noteId);
  const projects = useProjects();
  const projectIds = useMemo(() => new Set((projects.data ?? []).map((p) => p.id)), [projects.data]);
  const [showAll, setShowAll] = useState(false);
  const [target, setTarget] = useState<CommitDiffTarget | null>(null);

  const data = history.data;
  const entries = data?.entries ?? [];
  const visible = showAll ? entries : entries.slice(0, INITIAL_ROWS);
  const count = data?.git.ok && entries.length > 0 ? `${entries.length}${data.hasMore ? "+" : ""}` : null;

  return (
    <SectionCard
      density="dense"
      title="History"
      actions={count ? <span className="text-sm text-muted-foreground tabular-nums">{count}</span> : undefined}
      className={cn("min-w-0", className)}
    >
      {history.isPending ? (
        <HistorySkeleton />
      ) : history.error || !data ? (
        <ErrorState size="sm" title="Could not load the history" error={history.error ?? undefined} onRetry={() => void history.refetch()} />
      ) : !data.git.ok ? (
        <EmptyState size="sm" icon={GitBranch} title="No git history" body={data.git.reason === "not-a-repo" ? "The po-workspace is not a git repository." : data.git.message} />
      ) : entries.length === 0 ? (
        <EmptyState size="sm" icon={History} title="Not committed yet" body="The history starts with the commit that adds this note to the vault." />
      ) : (
        <div className="flex flex-col gap-2">
          <ol className="flex flex-col divide-y divide-rule">
            {visible.map((e) => (
              <HistoryRow
                key={e.sha}
                entry={e}
                projectLinked={!!e.project && projectIds.has(e.project)}
                onDiff={() => setTarget({ sha: e.sha, file: e.path })}
              />
            ))}
          </ol>
          {entries.length > INITIAL_ROWS && !showAll ? (
            <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setShowAll(true)}>
              Show all {entries.length}
              {data.hasMore ? "+" : ""}
            </Button>
          ) : null}
          {showAll && data.hasMore ? (
            <p className="text-xs text-muted-foreground">
              Older commits are on the{" "}
              <Link href={memoryViewHref("timeline")} className="text-primary underline-offset-2 hover:underline">
                vault timeline
              </Link>
              .
            </p>
          ) : null}
        </div>
      )}
      <CommitDiffSheet target={target} onFileChange={(file) => setTarget((t) => (t ? { ...t, file } : t))} onClose={() => setTarget(null)} />
    </SectionCard>
  );
}
