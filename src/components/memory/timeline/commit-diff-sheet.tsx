"use client";

/**
 * The vault diff drawer (plan §4), a right Sheet like the QA ReviewSheet: one commit (or the
 * uncommitted working tree) with its file list (a side list on lg, a Select below), the claim
 * changes of the file shown (`^c-` chips link to the live claim on its note), banners for a cut
 * diff or uncounted claims, and the unified diff through TextDiff. Controlled: the timeline keeps
 * the target in `?commit=<short>&file=<path>`, the note History card in local state.
 */
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Archive, BadgeCheck, CircleCheck, ExternalLink, Files, GitCommitHorizontal, GitBranch, ListPlus, ListX, PencilLine, TriangleAlert, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { EmptyState, ErrorState, IdChip, RelativeTime, StatusPill } from "@/components/common";
import { TextDiff } from "@/components/docs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { useMemoryCommit, useMemoryOverview } from "@/lib/api/queries";
import { formatNumber, plural } from "@/lib/format";
import {
  MEMORY_WORKING_SHA,
  type MemoryClaimChange,
  type MemoryClaimChangeKind,
  type MemoryCommitDiffPayload,
  type MemoryCommitFile,
  type MemoryTimelineEvent,
  type MemoryTimelineEventKind,
  type MemoryTimelinePayload,
} from "@/lib/memory/types";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/weft/labels";
import { ChangeChips } from "./change-chips";
import { ALL_FILES_MAX_LINES, vaultLabel } from "./event-headline";
import { FileStatusGlyph, resolveNote } from "./timeline-rail";

export interface CommitDiffTarget {
  /** A commit sha (short or full) or MEMORY_WORKING_SHA. */
  sha: string;
  /** The file shown (workspace-relative, `memory/…`); null for every file of the commit. */
  file: string | null;
}

export interface CommitDiffSheetProps {
  target: CommitDiffTarget | null;
  /** Another file was picked (null: every file). */
  onFileChange: (file: string | null) => void;
  onClose: () => void;
}

interface KindMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

const EVENT_KIND_META: Record<MemoryTimelineEventKind, KindMeta> = {
  signoff: { label: "Sign-off", tone: "success", icon: BadgeCheck },
  commit: { label: "Commit", tone: "neutral", icon: GitCommitHorizontal },
  uncommitted: { label: "Uncommitted", tone: "attention", icon: PencilLine },
};

export const CLAIM_CHANGE_META: Record<MemoryClaimChangeKind, KindMeta> = {
  added: { label: "Added", tone: "success", icon: ListPlus },
  promoted: { label: "Promoted", tone: "success", icon: CircleCheck },
  edited: { label: "Edited", tone: "neutral", icon: PencilLine },
  retired: { label: "Retired", tone: "neutral", icon: Archive },
  removed: { label: "Removed", tone: "danger", icon: ListX },
};

const BLOCK_CHIP = "inline-flex h-6 shrink-0 items-center rounded-[8px] bg-foreground/[0.05] px-2 font-mono text-xs text-foreground tabular-nums dark:bg-foreground/[0.07]";

/** The Select's value for "every file" (paths always start with `memory/`). */
const ALL = "*";

function sheetTitle(commit: MemoryTimelineEvent): string {
  if (commit.kind === "uncommitted") return "Uncommitted changes";
  if (commit.kind === "signoff") return `Signed off ${commit.project ?? "a project"}`;
  return commit.subject.trim() || "(no commit message)";
}

/** A `^c-<id>` chip, linking to the claim on its note while it is live there. */
function BlockChip({ change, live }: { change: Pick<MemoryClaimChange, "blockId" | "noteId">; live: boolean }) {
  if (!live) return <span className={cn(BLOCK_CHIP, "text-muted-foreground")}>^c-{change.blockId}</span>;
  return (
    <Link href={`/memory/${change.noteId}#c-${change.blockId}`} className={cn(BLOCK_CHIP, "underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none")}>
      ^c-{change.blockId}
    </Link>
  );
}

function ClaimChangeRow({ change, notes, showNote }: { change: MemoryClaimChange; notes?: ReadonlyMap<string, string>; showNote: boolean }) {
  const meta = CLAIM_CHANGE_META[change.kind];
  const noteExists = notes ? notes.has(change.noteId) : true;
  // Retired and removed claims have no anchor on the note any more.
  const live = noteExists && (change.kind === "added" || change.kind === "edited" || change.kind === "promoted");
  return (
    <li className="flex flex-col gap-1.5 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill tone={meta.tone} icon={meta.icon} label={meta.label} size="sm" />
        <BlockChip change={change} live={live} />
        {showNote ? <span className="min-w-0 truncate text-xs text-muted-foreground">{notes?.get(change.noteId) ?? change.noteId}</span> : null}
      </div>
      <p className={cn("text-sm leading-6", change.kind === "removed" || change.kind === "retired" ? "text-muted-foreground" : "text-foreground")}>{change.text}</p>
      {change.previousText !== undefined && change.previousText !== change.text ? (
        <p className="text-[13px] leading-5 text-muted-foreground">
          <span className="sr-only">Before: </span>
          <span className="line-through decoration-muted-foreground/40">{change.previousText}</span>
        </p>
      ) : null}
      {change.kind === "retired" && change.reason ? (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          retired: {change.reason}
          {change.supersededBy ? (
            <>
              <span aria-hidden>·</span> superseded by <BlockChip change={{ blockId: change.supersededBy, noteId: change.noteId }} live={noteExists} />
            </>
          ) : null}
        </p>
      ) : null}
    </li>
  );
}

function FileLabel({ file, notes }: { file: MemoryCommitFile; notes?: ReadonlyMap<string, string> }) {
  const note = resolveNote(file, notes);
  return note ? <span className="truncate">{note.title}</span> : <span className="truncate font-mono text-xs">{vaultLabel(file.path)}</span>;
}

/** The lg file list: "All files" (when the server serves it), then notes, then other vault files. */
function FileNav({ data, selected, allowAll, notes, onPick }: { data: MemoryCommitDiffPayload; selected: string | null; allowAll: boolean; notes?: ReadonlyMap<string, string>; onPick: (file: string | null) => void }) {
  const item = (active: boolean) =>
    cn(
      "flex w-full min-w-0 items-center gap-2 rounded-[12px] px-2.5 py-1.5 text-left text-[13px] leading-5 transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
      active ? "bg-raised text-heading shadow-(--raised-shadow)" : "text-foreground hover:bg-well/70",
    );
  const notesFirst = data.files.filter((f) => f.noteId || f.oldNoteId);
  const others = data.files.filter((f) => !f.noteId && !f.oldNoteId);
  const row = (f: MemoryCommitFile) => (
    <li key={f.path}>
      <button type="button" className={item(selected === f.path)} aria-current={selected === f.path ? "true" : undefined} onClick={() => onPick(f.path)}>
        <FileStatusGlyph status={f.status} />
        <span className="min-w-0 flex-1 truncate">
          <FileLabel file={f} notes={notes} />
        </span>
        {f.claims.length > 0 ? (
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums" title={plural(f.claims.length, "claim change")}>
            {f.claims.length}
            <span className="sr-only"> claim changes</span>
          </span>
        ) : null}
      </button>
    </li>
  );
  return (
    <nav aria-label="Changed files" className="flex flex-col gap-3">
      {allowAll ? (
        <button type="button" className={item(selected === null)} aria-current={selected === null ? "true" : undefined} onClick={() => onPick(null)}>
          <Files aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1">All files</span>
          <span className="text-[11px] text-muted-foreground tabular-nums">{data.files.length}</span>
        </button>
      ) : null}
      {notesFirst.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="px-2.5 text-xs font-medium text-muted-foreground">Notes</span>
          <ul className="flex flex-col gap-0.5">{notesFirst.map(row)}</ul>
        </div>
      ) : null}
      {others.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="px-2.5 text-xs font-medium text-muted-foreground">Other vault files</span>
          <ul className="flex flex-col gap-0.5">{others.map(row)}</ul>
        </div>
      ) : null}
    </nav>
  );
}

function FileSelect({ data, selected, allowAll, notes, onPick }: { data: MemoryCommitDiffPayload; selected: string | null; allowAll: boolean; notes?: ReadonlyMap<string, string>; onPick: (file: string | null) => void }) {
  return (
    <Select value={selected ?? ALL} onValueChange={(v) => onPick(v === ALL ? null : v)}>
      <SelectTrigger aria-label="Changed file" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-80">
        {allowAll ? <SelectItem value={ALL}>All files ({data.files.length})</SelectItem> : null}
        {data.files.map((f) => {
          const note = resolveNote(f, notes);
          return (
            <SelectItem key={f.path} value={f.path}>
              {f.status} · {note ? note.title : vaultLabel(f.path)}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function Banner({ tone, children }: { tone: "attention" | "neutral"; children: ReactNode }) {
  return (
    <p role="note" className={cn("flex items-start gap-2.5 rounded-[16px] px-4 py-3 text-[13px] leading-5", tone === "attention" ? "bg-status-attention-bg text-status-attention-fg" : "bg-well/70 text-foreground")}>
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
      <span>{children}</span>
    </p>
  );
}

/** A timeline event already in the cache (any filter), for a deep link to a commit too large to open without a file. */
function useCachedEvent(sha: string): MemoryTimelineEvent | undefined {
  const qc = useQueryClient();
  for (const [, data] of qc.getQueriesData<InfiniteData<MemoryTimelinePayload>>({ queryKey: ["memory", "timeline"] })) {
    for (const page of data?.pages ?? []) {
      const hit = page.events.find((e) => e.sha.startsWith(sha)) ?? (page.working && page.working.sha === sha ? page.working : undefined);
      if (hit) return hit;
    }
  }
  return undefined;
}

function SheetBody({ target, onFileChange }: { target: CommitDiffTarget; onFileChange: (file: string | null) => void }) {
  const query = useMemoryCommit(target.sha, target.file);
  const overview = useMemoryOverview();
  const notes = useMemo(() => (overview.data ? new Map(overview.data.notes.map((n) => [n.card.id, n.card.title])) : undefined), [overview.data]);
  // The last payload stays on screen (header and file list) while another file of the same commit loads.
  const [shown, setShown] = useState<MemoryCommitDiffPayload | null>(null);
  const cached = useCachedEvent(target.sha);
  const data = query.data ?? shown;
  const commit = data?.commit ?? null;

  const pick = (file: string | null) => {
    if (query.data) setShown(query.data);
    onFileChange(file);
  };

  const tooLarge = query.error instanceof ApiError && query.error.status === 400 && target.file === null;
  if (!data) {
    return (
      <>
        <SheetHeader className="gap-2 border-b border-rule px-5 pt-5 pb-4 pr-14 sm:px-6">
          <SheetTitle className={query.error ? "text-[22px] leading-7 font-normal tracking-[-0.02em] text-heading" : "sr-only"}>
            {query.error ? `Commit ${target.sha === MEMORY_WORKING_SHA ? "changes" : target.sha}` : "Loading the commit"}
          </SheetTitle>
          {query.error ? null : (
            <>
              <Skeleton className="h-6 w-48 rounded-full" />
              <Skeleton className="h-7 w-80 max-w-full" />
              <Skeleton className="h-5 w-64 max-w-full" />
            </>
          )}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {tooLarge && cached ? (
            <div className="flex flex-col gap-3">
              <Banner tone="neutral">This commit changes too many lines to show at once. Pick a file:</Banner>
              <ul className="flex flex-col gap-1">
                {cached.files.slice(0, 50).map((f) => (
                  <li key={f.path}>
                    <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => onFileChange(f.path)}>
                      <FileStatusGlyph status={f.status} />
                      <span className="truncate">{resolveNote(f, notes)?.title ?? vaultLabel(f.path)}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : query.error ? (
            <ErrorState
              size="sm"
              title="Could not load the diff"
              error={query.error}
              onRetry={query.error instanceof ApiError && query.error.status < 500 ? undefined : () => void query.refetch()}
            />
          ) : (
            <Skeleton className="h-[50vh] w-full rounded-[16px]" />
          )}
        </div>
      </>
    );
  }

  if (!commit) {
    return (
      <>
        <SheetHeader className="border-b border-rule px-5 pt-5 pb-4 pr-14 sm:px-6">
          <SheetTitle className="text-[22px] leading-7 font-normal tracking-[-0.02em] text-heading">No git history</SheetTitle>
        </SheetHeader>
        <EmptyState size="sm" icon={GitBranch} title="Git is not available" body={data.git.ok ? undefined : data.git.message} />
      </>
    );
  }

  const meta = EVENT_KIND_META[commit.kind];
  const selected = target.file;
  const selectedFile = selected ? data.files.find((f) => f.path === selected || f.oldPath === selected) : undefined;
  const allowAll = commit.totals.linesAdded + commit.totals.linesRemoved <= ALL_FILES_MAX_LINES;
  const changes = selected ? (selectedFile?.claims ?? []) : data.files.flatMap((f) => f.claims);
  const selectedNote = selectedFile ? resolveNote(selectedFile, notes) : null;
  // The diff for the current selection: the live query, never the payload kept for another file.
  const current = query.data;
  const at = Date.parse(commit.committedAt);

  return (
    <>
      <SheetHeader className="gap-2 border-b border-rule px-5 pt-5 pb-4 pr-14 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={meta.tone} icon={meta.icon} label={meta.label} size="sm" />
          {commit.kind === "uncommitted" ? null : (
            <IdChip id={commit.sha} size="sm">
              {commit.shortSha}
            </IdChip>
          )}
          {Number.isFinite(at) ? <RelativeTime at={at} prefix={commit.kind === "uncommitted" ? "last edit" : undefined} className="text-xs text-muted-foreground" /> : null}
        </div>
        <SheetTitle className="text-[22px] leading-7 font-normal tracking-[-0.02em] break-words text-heading">{sheetTitle(commit)}</SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px]">
          {commit.author ? (
            <span title={commit.author.email}>
              {commit.author.name}
              {commit.kind === "signoff" && commit.subject ? <span className="font-mono text-xs"> · {commit.subject}</span> : null}
            </span>
          ) : (
            <span>The working tree compared with the last commit</span>
          )}
          <ChangeChips totals={commit.totals} claimsAnalysed={commit.claimsAnalysed} />
        </SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[288px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 overflow-y-auto border-r border-rule px-3 py-4 lg:block">
          <FileNav data={data} selected={selected} allowAll={allowAll} notes={notes} onPick={pick} />
        </aside>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="lg:hidden">
            <FileSelect data={data} selected={selected} allowAll={allowAll} notes={notes} onPick={pick} />
          </div>

          {selectedNote ? (
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 truncate text-[15px] font-medium text-heading">{selectedNote.title}</h3>
              <span className="font-mono text-xs text-muted-foreground">{vaultLabel(selectedFile?.path ?? "")}</span>
              {selectedNote.exists ? (
                <Button asChild size="xs" variant="secondary">
                  <Link href={`/memory/${selectedNote.id}`}>
                    <ExternalLink aria-hidden />
                    Open note
                  </Link>
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">(removed from the vault)</span>
              )}
            </div>
          ) : null}

          {commit.claimsAnalysed === "too-large" ? (
            <Banner tone="neutral">Claims were not counted: this change touches more than 200,000 note lines.</Banner>
          ) : commit.claimsAnalysed === "failed" ? (
            <Banner tone="neutral">Claims could not be counted: git failed to produce the claim diff.</Banner>
          ) : commit.claimsAnalysed === "truncated" ? (
            <Banner tone="neutral">Claim counts are a lower bound: the claim diff was cut at 4 MB.</Banner>
          ) : null}
          {current?.truncated ? (
            <Banner tone="attention">This diff is cut at 1 MB. Open the file in the po-workspace or Obsidian to read the rest.</Banner>
          ) : null}

          {changes.length > 0 ? (
            <section aria-label="Claim changes" className="flex flex-col">
              <h3 className="text-[15px] font-medium text-heading">
                Claim changes <span className="text-sm font-normal text-muted-foreground tabular-nums">{formatNumber(changes.length)}</span>
              </h3>
              <ul className="flex flex-col divide-y divide-rule">
                {changes.map((c) => (
                  <ClaimChangeRow key={`${c.noteId}:${c.blockId}:${c.kind}`} change={c} notes={notes} showNote={!selected} />
                ))}
              </ul>
            </section>
          ) : null}

          {current ? (
            <TextDiff diffText={current.diff} emptyText="No line changes: a rename or a mode change only." />
          ) : query.error ? (
            <ErrorState size="sm" title="Could not load this file's diff" error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <Skeleton className="h-[40vh] w-full rounded-[16px]" />
          )}
        </div>
      </div>
    </>
  );
}

export function CommitDiffSheet({ target, onFileChange, onClose }: CommitDiffSheetProps) {
  return (
    <Sheet open={!!target} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl data-[side=right]:lg:max-w-5xl">
        {/* Keyed by commit: the payload kept between files never leaks into another commit. */}
        {target ? <SheetBody key={target.sha} target={target} onFileChange={onFileChange} /> : <SheetTitle className="sr-only">Vault diff</SheetTitle>}
      </SheetContent>
    </Sheet>
  );
}
