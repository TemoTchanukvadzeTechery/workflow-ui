"use client";

/**
 * /memory/[...id] — the note detail page (plan A4): header (title, type, status pill, flag pills,
 * copy-id / copy-citation / refresh circle buttons), the frontmatter card, the claims card, the
 * prose rendered through the docs Markdown component with the wikilinks plugin, and the
 * Connections right rail with a one-hop ego graph (plan A5) above its link groups. A #c-xxxxxx
 * location hash scrolls to and rings that claim row. An unknown or malformed id renders a 404
 * state linking back to /memory with a search prefill.
 */
import { useQueryClient } from "@tanstack/react-query";
import { BookMarked, Check, Copy, ExternalLink, RefreshCw, SearchX, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CardSkeleton, CircleIconButton, EmptyState, ErrorState, PageHeader, SectionCard, toneClasses } from "@/components/common";
import { Markdown, type MarkdownProps } from "@/components/docs";
import { ClaimsList } from "@/components/memory/claims-list";
import { ConnectionsRail } from "@/components/memory/connections-rail";
import { FrontmatterCard } from "@/components/memory/frontmatter-card";
import { MemoryGraph } from "@/components/memory/memory-graph";
import { NoteOutline } from "@/components/memory/note-outline";
import { MemoryTypeLabel, NoteFlagPills, NoteStatusPill, OriginChip } from "@/components/memory/status-meta";
import { remarkWikilinks } from "@/components/memory/wikilinks";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy } from "@/hooks/use-copy";
import { ApiError } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import { useMemoryGraph, useMemoryNote, useMemoryStatus } from "@/lib/api/queries";
import { isMemoryNoteId } from "@/lib/memory/types";
import { cn } from "@/lib/utils";

const HASH_RE = /^#(c-[0-9a-f]{6})$/;

/** Obsidian vault name for "Open in Obsidian"; the button is hidden when unset. */
const OBSIDIAN_VAULT = process.env.NEXT_PUBLIC_OBSIDIAN_VAULT;

function obsidianHref(vault: string, notePath: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(notePath.replace(/\.md$/, ""))}`;
}

/**
 * Seeded notes open their `## Overview` with a `### Overview` of the same name; drop the repeated
 * sub-heading (its text stays) so the page does not read "Overview / Overview".
 */
function dedupeLeadHeadings(prose: string): string {
  return prose.replace(/^## +(.+?)[ \t]*\n(?:[ \t]*\n)*### +\1[ \t]*$/gm, "## $1");
}

/** Why a seed-blocked note is a stub (plan A7 trust signals). */
function SeedBlockedNotice() {
  const tone = toneClasses("attention");
  return (
    <div role="note" className={cn("flex items-start gap-3 rounded-[20px] px-5 py-4 text-sm", tone.bg)}>
      <ShieldAlert aria-hidden className={cn("mt-0.5 size-4 shrink-0", tone.text)} strokeWidth={2} />
      <p className="text-foreground">
        <span className={cn("font-medium", tone.text)}>Seed blocked. </span>
        The secret scan flagged this repository when the vault was seeded, so this note is a stub. Fill it in from the repository in
        Obsidian; the page picks up the change on the next refresh.
      </p>
    </div>
  );
}

/** Unknown or malformed id (plan A7): the way back, plus a search prefill for the slug. */
function NoteNotFound({ id }: { id: string }) {
  const slug = id.split("/").filter(Boolean).pop() ?? id;
  return (
    <SectionCard>
      <EmptyState
        icon={SearchX}
        title={
          <>
            No memory note <span className="font-mono">{id || "(empty)"}</span>
          </>
        }
        body={
          <>
            Note ids look like <span className="font-mono">system/customer-service</span>. The note may have been renamed or removed — try
            searching the vault for “{slug}”.
          </>
        }
        action={
          <>
            <Button asChild variant="secondary">
              <Link href="/memory">Back to memory</Link>
            </Button>
            <Button asChild>
              <Link href={`/memory?q=${encodeURIComponent(slug)}`}>Search “{slug}”</Link>
            </Button>
          </>
        }
      />
    </SectionCard>
  );
}

function NoteSkeleton({ caption }: { caption?: string }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading note">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-80 max-w-full sm:h-12" />
        <Skeleton className="h-6 w-64 max-w-full rounded-full" />
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          <CardSkeleton rows={5} />
          <CardSkeleton rows={4} />
        </div>
        <CardSkeleton rows={7} />
      </div>
      {caption ? (
        <p role="status" className="text-center text-sm text-muted-foreground">
          {caption}
        </p>
      ) : null}
    </div>
  );
}

export function MemoryNoteView({ id }: { id: string }) {
  const valid = isMemoryNoteId(id);
  const note = useMemoryNote(valid ? id : undefined);
  // While the note loads, the status says whether the wait is the index (auto-)building.
  const status = useMemoryStatus({ enabled: valid && note.isPending });
  // The whole-vault graph (cached, shared with /memory); the rail keeps the note's one-hop ego view.
  const graph = useMemoryGraph({ enabled: valid });
  const qc = useQueryClient();
  const copyId = useCopy();
  const copyCitation = useCopy();

  // The #c-xxxxxx hash: tracked in state so the ring follows in-page hash changes too.
  const [anchor, setAnchor] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setAnchor(HASH_RE.exec(window.location.hash)?.[1] ?? null);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const loaded = note.data !== undefined;
  useEffect(() => {
    if (!anchor || !loaded) return;
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [anchor, loaded]);

  const resolvedLinks = note.data?.resolvedLinks;
  const rawProse = note.data?.prose;
  const prose = useMemo(() => dedupeLeadHeadings(rawProse ?? ""), [rawProse]);
  const wikilinkPlugins = useMemo(
    () => [[remarkWikilinks, { links: resolvedLinks ?? {} }]] as unknown as NonNullable<MarkdownProps["remarkPlugins"]>,
    [resolvedLinks],
  );

  if (!valid || (note.error instanceof ApiError && note.error.status === 404)) return <NoteNotFound id={id} />;
  if (note.error) {
    // A 503 message already names the resolved workspace path and the MEMORY_WORKSPACE fix (plan A7).
    return (
      <SectionCard>
        <ErrorState title="Could not load this note" error={note.error} onRetry={() => void note.refetch()} />
      </SectionCard>
    );
  }
  if (!note.data) {
    const indexState = status.data?.indexState;
    return (
      <NoteSkeleton
        caption={
          indexState === "building" || indexState === "missing"
            ? "Building the memory search index — the first build may download a small embeddings model."
            : undefined
        }
      />
    );
  }

  const detail = note.data;
  const { card } = detail;
  const origin = typeof card.props.origin === "string" ? card.props.origin : undefined;
  const hasNeighbors = detail.neighbors.out.length + detail.neighbors.in.length > 0;
  // Nothing while the graph loads or failed: the rail's link groups already list every neighbor.
  // A busy note's one-hop cloud is dense and roughly round, so it gets more height to read.
  const egoSize = new Set([...detail.neighbors.out, ...detail.neighbors.in].map((n) => n.id)).size;
  const egoGraph =
    hasNeighbors && graph.isSuccess ? <MemoryGraph data={graph.data} focusId={id} hops={1} height={egoSize > 8 ? 280 : 200} interactive /> : null;

  return (
    <div className="@container flex min-w-0 flex-col gap-6">
      <PageHeader
        size="md"
        title={card.title}
        actions={
          <>
            <CircleIconButton
              icon={copyId.copied ? Check : Copy}
              label={`Copy note id ${id}`}
              title="Copy the note id"
              onClick={() => void copyId.copy(id, "the note id")}
            />
            <CircleIconButton
              icon={copyCitation.copied ? Check : BookMarked}
              label={`Copy citation [M ${id}]`}
              title={`Copy the [M ${id}] citation`}
              onClick={() => void copyCitation.copy(`[M ${id}]`, "the citation")}
            />
            {OBSIDIAN_VAULT ? (
              <CircleIconButton icon={ExternalLink} label="Open in Obsidian" title="Open in Obsidian" href={obsidianHref(OBSIDIAN_VAULT, card.path)} />
            ) : null}
            <CircleIconButton
              icon={<RefreshCw aria-hidden className={cn("size-[18px]", note.isFetching && "animate-spin")} strokeWidth={1.75} />}
              label="Refresh this note"
              title="Refresh"
              disabled={note.isFetching}
              onClick={() => void qc.invalidateQueries({ queryKey: qk.memoryNote(id) })}
            />
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <MemoryTypeLabel type={card.type} className="text-sm text-muted-foreground" />
          <NoteStatusPill status={card.status} />
          <OriginChip origin={origin} />
          <NoteFlagPills flags={detail.flags} />
          <span className="font-mono text-xs text-muted-foreground">{id}</span>
        </div>
      </PageHeader>

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {detail.flags.seedBlocked ? <SeedBlockedNotice /> : null}
          <FrontmatterCard detail={detail} />
          <ClaimsList noteId={id} claims={detail.claims} retired={detail.retired} highlight={anchor} />
          {prose !== "" ? (
            <SectionCard density="dense">
              <Markdown source={prose} remarkPlugins={wikilinkPlugins} />
            </SectionCard>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-4 xl:self-stretch">
          <ConnectionsRail neighbors={detail.neighbors} graphSlot={egoGraph} />
          <NoteOutline prose={prose} className="hidden xl:sticky xl:top-24 xl:flex" />
        </div>
      </div>
    </div>
  );
}
