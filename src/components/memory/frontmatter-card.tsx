/**
 * The note-detail frontmatter card (plan A4): the summary paragraph, the identity facts (type,
 * status, origin, updated, category, owner — the owner wikilink resolving to a /memory link via
 * the note's `owner` edge), tags as chips, aliases muted, the frontmatter sources as SourceLinks,
 * and the document-note extras (doc_type, workspace path, accepted sha, signed_off_at, drifted
 * pill). Hook-free and server-compatible.
 */
import Link from "next/link";
import { FactCell, SectionCard } from "@/components/common";
import type { MemoryNoteDetailPayload } from "@/lib/memory/types";
import { cn } from "@/lib/utils";
import { MemoryTypeLabel, NoteStatusPill, OriginChip, StaleDocPill } from "./status-meta";
import { SourceLink } from "./source-link";
import { parseWikilink } from "./wikilinks";

/** `b58a…91ef2c` — hashes truncate in the middle so both ends stay comparable. */
function midTruncate(value: string, keep = 8): string {
  return value.length <= keep * 2 + 1 ? value : `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

/** The owner fact: display text from the wikilink, href from the note's `owner` edge when it resolved. */
function ownerFact(detail: MemoryNoteDetailPayload): { label: string; href?: string } | null {
  const raw = detail.card.props.owner;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const inner = /^\[\[([^[\]]+)\]\]$/.exec(raw.trim())?.[1] ?? raw.trim();
  const { target, alias } = parseWikilink(inner);
  const edge = detail.neighbors.out.find((n) => n.property === "owner");
  if (edge) return { label: alias || edge.title || edge.id, href: `/memory/${edge.id}` };
  return { label: alias || target };
}

export interface FrontmatterCardProps {
  detail: MemoryNoteDetailPayload;
  className?: string;
}

export function FrontmatterCard({ detail, className }: FrontmatterCardProps) {
  const { card, flags } = detail;
  const { props } = card;
  const owner = ownerFact(detail);
  const origin = typeof props.origin === "string" ? props.origin : undefined;
  const tags = props.tags ?? [];
  const aliases = props.aliases ?? [];
  const sources = props.sources ?? [];
  const isDocument = card.type === "document";

  return (
    <SectionCard density="dense" className={className} bodyClassName="flex flex-col gap-5">
      {card.summary ? <p className="max-w-3xl text-[15px] leading-6 text-foreground">{card.summary}</p> : null}

      <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
        <FactCell label="Type" value={<MemoryTypeLabel type={card.type} />} />
        <FactCell label="Status" value={<NoteStatusPill status={card.status} />} />
        <FactCell label="Origin" value={origin ? <OriginChip origin={origin} /> : null} />
        <FactCell label="Updated" value={card.updated} numeric />
        <FactCell label="Category" value={props.category} />
        <FactCell
          label="Owner"
          value={
            owner ? (
              owner.href ? (
                <Link href={owner.href} className="text-primary underline-offset-2 hover:underline">
                  {owner.label}
                </Link>
              ) : (
                owner.label
              )
            ) : null
          }
        />
        {card.project ? <FactCell label="Project" value={card.project} mono /> : null}
      </div>

      {tags.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] leading-5 text-muted-foreground">Tags</span>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex h-6 items-center rounded-full bg-well px-2.5 text-xs text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {aliases.length > 0 ? (
        <p className="text-[13px] leading-5 text-muted-foreground">
          Also known as <span className="text-foreground/80">{aliases.join(", ")}</span>
        </p>
      ) : null}

      {sources.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] leading-5 text-muted-foreground">Sources</span>
          <div className="flex flex-wrap gap-1.5">
            {sources.map((source, i) => (
              <SourceLink key={`${source}-${i}`} source={source} />
            ))}
          </div>
        </div>
      ) : null}

      {isDocument ? (
        <div className={cn("flex flex-col gap-4 border-t border-rule pt-4")}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-medium text-heading">Signed-off document</h3>
            {flags.isStaleDoc ? <StaleDocPill /> : null}
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
            <FactCell label="Document type" value={props.doc_type} />
            <FactCell label="Path" value={props.path} mono />
            <FactCell
              label="Accepted sha"
              value={props.accepted_sha256 ? <span title={props.accepted_sha256}>{midTruncate(props.accepted_sha256)}</span> : null}
              mono
            />
            <FactCell label="Signed off" value={props.signed_off_at} numeric />
            {props.run ? <FactCell label="Run" value={props.run} mono /> : null}
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}
