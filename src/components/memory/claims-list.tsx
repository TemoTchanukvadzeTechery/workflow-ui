"use client";

/**
 * The note-detail claims card (plan A4): each claim shows its ^c- mono block-id chip, the claim
 * text, a (proposed) review pill, a stale-source attention pill whose glass tooltip names the
 * drifted document, its SourceLinks, and a copy button for the `[M <id>#^c-xxxxxx]` citation.
 * Retired claims collapse under "Retired claims (n)" with their reasons. With no claims (today's
 * norm: the vault has none yet) an EmptyState explains where claims come from. The page's
 * #c-xxxxxx hash highlights the matching row via `highlight`.
 */
import { Check, ChevronRight, Copy, ListChecks, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { EmptyState, SectionCard, StatusPill } from "@/components/common";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopy } from "@/hooks/use-copy";
import type { MemoryClaim, MemoryRetiredClaim } from "@/lib/memory/types";
import { cn } from "@/lib/utils";
import { ProposedPill } from "./status-meta";
import { SourceLink } from "./source-link";

const BLOCK_CHIP =
  "inline-flex h-6 shrink-0 items-center rounded-[8px] bg-foreground/[0.05] px-2 font-mono text-xs text-foreground tabular-nums dark:bg-foreground/[0.07]";

/** Copies `[M <id>#^c-xxxxxx]`; the icon flips to a check like IdChip's copy button. */
function CopyCitationButton({ citation }: { citation: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => void copy(citation, "the claim citation")}
      aria-label={copied ? "Copied" : `Copy ${citation}`}
      title={copied ? "Copied" : `Copy ${citation}`}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-(--chip-bg) hover:text-heading focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {copied ? <Check aria-hidden className="size-3.5 text-status-success-fg" /> : <Copy aria-hidden className="size-3.5" />}
    </button>
  );
}

/** The stale-source attention pill; hovering the pill names the drifted document (glass tooltip). */
function StaleSourceBadge({ docId }: { docId: string | null }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <StatusPill tone="attention" icon={TriangleAlert} label="Stale source" size="sm" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {docId ? (
          <span>
            <span className="font-mono">{docId}</span> changed after it was signed off; this claim may be out of date.
          </span>
        ) : (
          "The cited document changed after it was signed off; this claim may be out of date."
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function ClaimRow({ claim, noteId, highlighted }: { claim: MemoryClaim; noteId: string; highlighted: boolean }) {
  return (
    <li
      id={`c-${claim.blockId}`}
      className={cn(
        "-mx-3 flex scroll-mt-28 flex-col gap-2 rounded-[14px] px-3 py-3.5 transition-[box-shadow,background-color] duration-300",
        highlighted && "bg-primary/[0.05] ring-2 ring-primary/50",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={BLOCK_CHIP}>^c-{claim.blockId}</span>
        {claim.proposed ? <ProposedPill /> : null}
        {claim.stale ? <StaleSourceBadge docId={claim.docId} /> : null}
        <span className="min-w-2 flex-1" />
        <CopyCitationButton citation={`[M ${noteId}#^c-${claim.blockId}]`} />
      </div>
      <p className="text-[15px] leading-6 text-foreground">{claim.text}</p>
      {claim.sources.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {claim.sources.map((source, i) => (
            <SourceLink key={`${source.kind}-${source.ref}-${i}`} source={source} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

function RetiredSection({ retired }: { retired: MemoryRetiredClaim[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex items-center gap-1.5 rounded-[8px] text-[13px] font-medium text-muted-foreground transition-colors hover:text-heading focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
        <ChevronRight aria-hidden className="size-3.5 transition-transform group-data-[state=open]:rotate-90" strokeWidth={2.25} />
        Retired claims ({retired.length})
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-3 flex flex-col gap-3 border-l-2 border-rule pl-4">
          {retired.map((claim, i) => (
            <li key={claim.blockId ?? i} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {claim.blockId ? <span className={cn(BLOCK_CHIP, "text-muted-foreground")}>^c-{claim.blockId}</span> : null}
                {claim.proposed ? <ProposedPill /> : null}
                {claim.retired !== "" ? <span className="text-xs text-muted-foreground">retired: {claim.retired}</span> : null}
              </div>
              <p className="text-sm leading-6 text-muted-foreground line-through decoration-muted-foreground/40">{claim.text}</p>
              {claim.sources.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {claim.sources.map((source, j) => (
                    <SourceLink key={`${source.kind}-${source.ref}-${j}`} source={source} />
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export interface ClaimsListProps {
  /** The owning note id (`system/customer-service`), for the copied citations. */
  noteId: string;
  claims: MemoryClaim[];
  retired: MemoryRetiredClaim[];
  /** The page's location-hash anchor (`c-xxxxxx`): that row is ringed. */
  highlight?: string | null;
  className?: string;
}

export function ClaimsList({ noteId, claims, retired, highlight, className }: ClaimsListProps) {
  return (
    <SectionCard
      density="dense"
      title="Claims"
      actions={claims.length > 0 ? <span className="text-sm text-muted-foreground tabular-nums">{claims.length}</span> : undefined}
      className={className}
      bodyClassName="flex flex-col gap-4"
    >
      {claims.length === 0 ? (
        <EmptyState
          size="sm"
          icon={ListChecks}
          title="No claims yet"
          body="Claims appear when documents are signed off and memory updates are applied."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-rule">
          {claims.map((claim) => (
            <ClaimRow key={claim.blockId} claim={claim} noteId={noteId} highlighted={highlight === `c-${claim.blockId}`} />
          ))}
        </ul>
      )}
      {retired.length > 0 ? <RetiredSection retired={retired} /> : null}
    </SectionCard>
  );
}
