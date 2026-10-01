"use client";

/**
 * A memory citation chip ([M system/x] or [M system/x#^c-7f3a12], plan A6) as a link to the vault
 * note (`/memory/<id>`, plus `#c-<hex>` for a claim, which the detail page scrolls to and rings),
 * with a glass hover card that previews it: type icon and title, status and trust pills, the
 * summary, and for a claim citation the claim's text with its proposed / stale pills. The note is
 * fetched only once the card first opens (the preview mounts with the card), so a document with
 * hundreds of citations costs nothing until someone hovers one; the query cache keeps it after.
 */
import { CircleAlert, SearchX } from "lucide-react";
import Link from "next/link";
import { HoverCard as HoverCardPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import type { MemoryRef } from "@/components/docs/citations";
import { toneClasses } from "@/components/common/tone";
import { HoverCard, HoverCardTrigger } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { useMemoryNote } from "@/lib/api/queries";
import type { MemoryNoteDetailPayload } from "@/lib/memory/types";
import { cn } from "@/lib/utils";
import { MEMORY_TYPE_META, NoteFlagPills, NoteStatusPill, ProposedPill, StaleSourcePill } from "./status-meta";

/** `/memory/<type>/<slug>` plus the claim anchor the detail page understands (`#c-<hex>`). */
export function memoryRefHref(ref: MemoryRef): string {
  return `/memory/${ref.noteId}${ref.blockId ? `#c-${ref.blockId}` : ""}`;
}

export interface MemoryCitationCardProps {
  target: MemoryRef;
  /** What the chip cites, for the link's accessible name, e.g. "Memory note system/x, claim ^c-7f3a12". */
  label: string;
  /** The citation chip itself (Markdown's token chip), rendered inside the link. */
  children: ReactNode;
}

export function MemoryCitationCard({ target, label, children }: MemoryCitationCardProps) {
  return (
    <HoverCard openDelay={250} closeDelay={120}>
      <HoverCardTrigger asChild>
        <Link href={memoryRefHref(target)} aria-label={`Citation ${label}`} className="rounded-[5px] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          {children}
        </Link>
      </HoverCardTrigger>
      {/* The primitive's Content, not ui/hover-card's: the glass surface (STYLE.md 3, like TooltipContent) replaces the popover fill and shadow. */}
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="glass z-50 w-80 max-w-[calc(100vw-2rem)] origin-(--radix-hover-card-content-transform-origin) rounded-[16px] p-3.5 text-[13px] leading-5 text-foreground outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
        >
          <MemoryPreview target={target} />
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCard>
  );
}

/** Mounted only while the card is open, so the note query starts on first open. */
function MemoryPreview({ target }: { target: MemoryRef }) {
  const note = useMemoryNote(target.noteId);

  if (note.error instanceof ApiError && note.error.status === 404) {
    const tone = toneClasses("danger");
    return (
      <div className="flex items-start gap-2.5">
        <SearchX aria-hidden className={cn("mt-0.5 size-4 shrink-0", tone.text)} strokeWidth={2} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={cn("font-medium", tone.text)}>Not in the memory vault</span>
          <span className="text-muted-foreground">
            No note <span className="font-mono text-foreground">{target.noteId}</span>; it may have been renamed or removed.
          </span>
        </div>
      </div>
    );
  }
  if (note.error) {
    return (
      <div className="flex items-start gap-2.5">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium text-heading">Could not load this note</span>
          <span className="text-muted-foreground [overflow-wrap:anywhere]">{note.error.message}</span>
        </div>
      </div>
    );
  }
  if (!note.data) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading the memory note">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="mt-1 h-5 w-20 rounded-full" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    );
  }
  return <NotePreview detail={note.data} blockId={target.blockId} />;
}

const BLOCK_CHIP = "inline-flex h-5 shrink-0 items-center rounded-[6px] bg-foreground/[0.05] px-1.5 font-mono text-[11px] text-foreground tabular-nums dark:bg-foreground/[0.07]";

function NotePreview({ detail, blockId }: { detail: MemoryNoteDetailPayload; blockId?: string }) {
  const { card } = detail;
  const meta = MEMORY_TYPE_META[card.type];
  const Icon = meta.icon;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
        <div className="flex min-w-0 flex-col">
          <span className="text-[14px] leading-5 font-medium text-heading [overflow-wrap:anywhere]">{card.title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {meta.label} · <span className="font-mono">{card.id}</span>
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <NoteStatusPill status={card.status} />
        <NoteFlagPills flags={detail.flags} />
      </div>
      {card.summary ? <p className="line-clamp-4 text-muted-foreground">{card.summary}</p> : null}
      {blockId ? <ClaimPreview detail={detail} blockId={blockId} /> : null}
    </div>
  );
}

/** The cited claim; a retired one says so, a missing one says it is not in this note. */
function ClaimPreview({ detail, blockId }: { detail: MemoryNoteDetailPayload; blockId: string }) {
  const claim = detail.claims.find((c) => c.blockId === blockId);
  const retired = claim ? undefined : detail.retired.find((c) => c.blockId === blockId);
  return (
    <div className="flex flex-col gap-1.5 rounded-[12px] bg-foreground/[0.04] px-3 py-2.5 dark:bg-foreground/[0.06]">
      <div className="flex flex-wrap items-center gap-1">
        <span className={cn(BLOCK_CHIP, !claim && "text-muted-foreground")}>^c-{blockId}</span>
        {claim?.proposed ? <ProposedPill /> : null}
        {claim?.stale ? <StaleSourcePill docId={claim.docId} /> : null}
        {retired ? <span className="text-xs text-muted-foreground">retired{retired.retired ? `: ${retired.retired}` : ""}</span> : null}
      </div>
      {claim ? (
        <p className="line-clamp-5 text-foreground">{claim.text}</p>
      ) : retired ? (
        <p className="line-clamp-4 text-muted-foreground line-through decoration-muted-foreground/40">{retired.text}</p>
      ) : (
        <p className="text-muted-foreground">
          Claim <span className="font-mono">^c-{blockId}</span> not found in this note.
        </p>
      )}
    </div>
  );
}
