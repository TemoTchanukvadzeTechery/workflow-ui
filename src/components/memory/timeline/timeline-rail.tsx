"use client";

/**
 * The vault timeline's day-grouped rail (plan §4), built on ActivityFeed's node + connector
 * markup. Nodes: a sign-off is a raised success tile with BadgeCheck, a bulk import a Sprout, a
 * commit GitCommitHorizontal, a commit that changed no note a muted dot. Each row: the headline
 * (sign-offs link their project when the delivery layer knows it), author, a copyable short sha
 * and the time, the change pills, an expandable file list (notes link to their page, "(removed)"
 * when gone, other vault files grouped last) and "View diff".
 */
import { BadgeCheck, ChevronRight, FileDiff, GitCommitHorizontal, Sprout } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { IdChip, InitialsAvatar, toneClasses } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useNow } from "@/hooks/use-now";
import { formatDateTime, formatNumber, formatTime, plural } from "@/lib/format";
import type { MemoryFileChange, MemoryTimelineEvent } from "@/lib/memory/types";
import { cn } from "@/lib/utils";
import { formatDayMs } from "../day-label";
import { ChangeChips } from "./change-chips";
import { eventHeadline, FILE_STATUS_META, fileCount, timelineNodeKind, vaultLabel, type TimelineNodeKind } from "./event-headline";

/** Opens the diff sheet on an event, optionally on one of its files (workspace-relative path). */
export type ViewDiff = (event: MemoryTimelineEvent, file?: string | null) => void;

const NODE_BOX = "inline-flex size-9 shrink-0 items-center justify-center";

function EventNode({ kind }: { kind: TimelineNodeKind }) {
  if (kind === "signoff") {
    return (
      <span aria-hidden className={cn(NODE_BOX, "rounded-[12px] bg-status-success-bg text-status-success-fg shadow-(--raised-shadow)")}>
        <BadgeCheck className="size-[18px]" strokeWidth={2} />
      </span>
    );
  }
  if (kind === "files-only") {
    return (
      <span aria-hidden className={NODE_BOX}>
        <span className="size-2 rounded-full bg-status-neutral-solid/70" />
      </span>
    );
  }
  const Icon = kind === "bulk" ? Sprout : GitCommitHorizontal;
  return (
    <span aria-hidden className={cn(NODE_BOX, "rounded-full bg-well text-muted-foreground")}>
      <Icon className="size-4" strokeWidth={1.75} />
    </span>
  );
}

/** A one-letter A/M/D/R glyph in its tone, with the meaning for screen readers and in the title. */
export function FileStatusGlyph({ status, className }: { status: MemoryFileChange["status"]; className?: string }) {
  const meta = FILE_STATUS_META[status];
  const tone = toneClasses(meta.tone);
  return (
    <>
      <span
        aria-hidden
        title={meta.label}
        className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-[6px] font-mono text-[11px] font-semibold", tone.bg, tone.text, className)}
      >
        {meta.glyph}
      </span>
      <span className="sr-only">{meta.label}: </span>
    </>
  );
}

/** The note's current title, whether it still exists, and the id it lives under. */
export function resolveNote(f: MemoryFileChange, notes: ReadonlyMap<string, string> | undefined): { id: string; title: string; exists: boolean } | null {
  const id = f.noteId ?? f.oldNoteId;
  if (!id) return null;
  if (notes) return { id, title: notes.get(id) ?? f.title ?? id, exists: notes.has(id) };
  // Without the overview: the server's title means the note exists; a deletion without one probably does not.
  return { id, title: f.title ?? id, exists: f.title !== null || f.status !== "D" };
}

function LineCounts({ f }: { f: MemoryFileChange }) {
  if (f.additions === null || f.deletions === null) return <span className="shrink-0 text-[11px] text-muted-foreground">binary</span>;
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums">
      <span className="text-status-success-fg">+{formatNumber(f.additions)}</span> <span className="text-status-danger-fg">-{formatNumber(f.deletions)}</span>
    </span>
  );
}

function FileRow({ f, notes, onDiff }: { f: MemoryFileChange; notes?: ReadonlyMap<string, string>; onDiff: () => void }) {
  const note = resolveNote(f, notes);
  const label = note ? note.title : vaultLabel(f.path);
  return (
    <li className="flex min-w-0 items-center gap-2 py-1 text-[13px] leading-5">
      <FileStatusGlyph status={f.status} />
      <span className="min-w-0 flex-1 truncate">
        {note ? (
          note.exists ? (
            <Link href={`/memory/${note.id}`} className="text-foreground underline-offset-2 hover:text-heading hover:underline focus-visible:underline focus-visible:outline-none">
              {note.title}
            </Link>
          ) : (
            <>
              <span className="text-foreground">{note.title}</span> <span className="text-muted-foreground">(removed)</span>
            </>
          )
        ) : (
          <span className="font-mono text-xs text-foreground">{label}</span>
        )}
        {f.status === "R" && f.oldPath ? <span className="text-muted-foreground"> from {vaultLabel(f.oldPath)}</span> : null}
        {f.untracked ? <span className="text-muted-foreground"> (untracked)</span> : null}
      </span>
      <LineCounts f={f} />
      <button
        type="button"
        onClick={onDiff}
        aria-label={`View the diff of ${label}`}
        title="View the diff"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-(--chip-bg) hover:text-heading focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <FileDiff aria-hidden className="size-3.5" />
      </button>
    </li>
  );
}

/** Notes first, then the other vault files under their own caption; a note past the 500-file cap is counted, not listed. */
export function EventFileList({ event, notes, onViewDiff, className }: { event: MemoryTimelineEvent; notes?: ReadonlyMap<string, string>; onViewDiff: ViewDiff; className?: string }) {
  const noteFiles = event.files.filter((f) => f.noteId || f.oldNoteId);
  const others = event.files.filter((f) => !f.noteId && !f.oldNoteId);
  const hidden = fileCount(event.totals) - event.files.length;
  return (
    <div className={cn("max-h-80 overflow-y-auto rounded-[16px] bg-well/55 px-3 py-2 dark:bg-well", className)}>
      {noteFiles.length > 0 ? (
        <ul aria-label="Notes" className="flex flex-col">
          {noteFiles.map((f) => (
            <FileRow key={f.path} f={f} notes={notes} onDiff={() => onViewDiff(event, f.path)} />
          ))}
        </ul>
      ) : null}
      {others.length > 0 ? (
        <>
          <div className={cn("text-xs font-medium text-muted-foreground", noteFiles.length > 0 && "mt-2 border-t border-rule pt-2")}>Other vault files</div>
          <ul aria-label="Other vault files" className="flex flex-col">
            {others.map((f) => (
              <FileRow key={f.path} f={f} notes={notes} onDiff={() => onViewDiff(event, f.path)} />
            ))}
          </ul>
        </>
      ) : null}
      {hidden > 0 ? <p className="pt-1 text-xs text-muted-foreground">{plural(hidden, "more file")} not listed</p> : null}
    </div>
  );
}

function ProjectRef({ slug, linked }: { slug: string | null; linked: boolean }) {
  if (!slug) return <span className="font-medium">a project</span>;
  if (!linked) return <span className="font-medium">{slug}</span>;
  return (
    <Link href={`/projects/${slug}`} className="font-medium text-primary underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none">
      {slug}
    </Link>
  );
}

function TimelineRow({
  event,
  seeded,
  last,
  notes,
  projectIds,
  onViewDiff,
}: {
  event: MemoryTimelineEvent;
  seeded: boolean;
  last: boolean;
  notes?: ReadonlyMap<string, string>;
  projectIds?: ReadonlySet<string>;
  onViewDiff: ViewDiff;
}) {
  const [open, setOpen] = useState(false);
  const kind = timelineNodeKind(event);
  const files = fileCount(event.totals);
  const at = Date.parse(event.committedAt);
  return (
    <li className="flex gap-3.5 px-2 pt-2">
      <span className="relative flex flex-col items-center self-stretch">
        <EventNode kind={kind} />
        {!last ? <span aria-hidden className="my-1 w-px flex-1 bg-rule" /> : null}
      </span>
      <div className="min-w-0 flex-1 pt-0.5 pb-5">
        <p className={cn("text-sm leading-5 break-words", kind === "files-only" ? "text-muted-foreground" : "text-heading")}>
          {kind === "signoff" ? (
            <>
              Signed off <ProjectRef slug={event.project} linked={!!event.project && !!projectIds?.has(event.project)} />
            </>
          ) : (
            <>
              {kind === "commit" ? <span className="sr-only">Commit: </span> : null}
              {eventHeadline(event, { seeded })}
            </>
          )}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-5 text-muted-foreground">
          {event.author ? (
            <>
              <InitialsAvatar name={event.author.name || "?"} size="sm" />
              <span className="text-foreground" title={event.author.email}>
                {event.author.name}
              </span>
              <span aria-hidden>·</span>
            </>
          ) : null}
          <IdChip id={event.sha} size="sm">
            {event.shortSha}
          </IdChip>
          <span aria-hidden>·</span>
          {/* The day header already says which day; the row gives the time of day. */}
          {Number.isFinite(at) ? (
            <time dateTime={new Date(at).toISOString()} title={formatDateTime(at)} className="whitespace-nowrap tabular-nums">
              {formatTime(at)}
            </time>
          ) : null}
        </div>
        <ChangeChips totals={event.totals} claimsAnalysed={event.claimsAnalysed} className="mt-2" />
        <Collapsible open={open} onOpenChange={setOpen}>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CollapsibleTrigger className="group inline-flex h-7 items-center gap-1 rounded-[10px] px-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-heading focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
              <ChevronRight aria-hidden className="size-3.5 transition-transform group-data-[state=open]:rotate-90" strokeWidth={2.25} />
              {open ? "Hide files" : `Show ${plural(files, "file")}`}
            </CollapsibleTrigger>
            <Button type="button" size="xs" variant="secondary" onClick={() => onViewDiff(event)}>
              <FileDiff aria-hidden />
              View diff
            </Button>
          </div>
          <CollapsibleContent>
            <EventFileList event={event} notes={notes} onViewDiff={onViewDiff} className="mt-2" />
          </CollapsibleContent>
        </Collapsible>
      </div>
    </li>
  );
}

interface DayGroup {
  key: string;
  ms: number;
  events: MemoryTimelineEvent[];
}

/** Consecutive events by the local calendar day of their commit time (the list is newest first). */
function groupByDay(events: readonly MemoryTimelineEvent[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const e of events) {
    const ms = Date.parse(e.committedAt);
    const d = new Date(ms);
    const key = Number.isFinite(ms) ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : "unknown";
    const current = groups[groups.length - 1];
    if (current?.key === key) current.events.push(e);
    else groups.push({ key, ms, events: [e] });
  }
  return groups;
}

export interface TimelineRailProps {
  /** Newest first. */
  events: MemoryTimelineEvent[];
  /** The event that reads "Vault seeded" (the oldest bulk event, once the whole history is loaded). */
  seededSha?: string | null;
  /** Current note titles by id (the overview), for titles and "(removed)"; undefined while loading. */
  notes?: ReadonlyMap<string, string>;
  /** Project ids the delivery layer knows; a sign-off links its project only when listed. */
  projectIds?: ReadonlySet<string>;
  onViewDiff: ViewDiff;
  className?: string;
}

export function TimelineRail({ events, seededSha, notes, projectIds, onViewDiff, className }: TimelineRailProps) {
  const now = useNow(60_000);
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {groupByDay(events).map((group) => {
        const label = formatDayMs(group.ms, now) ?? "Unknown date";
        return (
          <section key={group.key} aria-label={label} className="flex flex-col">
            <h3 className="px-1 text-[13px] leading-5 font-medium text-muted-foreground" suppressHydrationWarning>
              {label}
            </h3>
            <ol className="relative -mx-2 flex flex-col">
              {group.events.map((e, i) => (
                <TimelineRow
                  key={e.sha}
                  event={e}
                  seeded={e.sha === seededSha}
                  last={i === group.events.length - 1}
                  notes={notes}
                  projectIds={projectIds}
                  onViewDiff={onViewDiff}
                />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
