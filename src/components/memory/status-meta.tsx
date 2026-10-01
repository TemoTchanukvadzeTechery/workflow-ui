/**
 * Shared meta for the memory pages (overview + detail + graph): type icons and labels, the type
 * filter groups, note-status and origin pill mappings, and the trust-signal pills. Data plus small
 * presentational helpers only — hook-free and server-compatible, like lib/weft/labels.ts. Status
 * is never color alone: every pill carries an icon and a label (STYLE.md 3).
 */
import {
  Archive,
  BadgeCheck,
  BookA,
  Boxes,
  CircleDashed,
  FileText,
  FolderKanban,
  Gauge,
  Landmark,
  ListChecks,
  Minus,
  PencilLine,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sprout,
  TriangleAlert,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { StatusPill, type SegmentedItem } from "@/components/common";
import { TYPE_GROUPS, type MemoryNoteFlags, type MemoryNoteType, type MemoryTypeGroup } from "@/lib/memory/types";
import type { Tone } from "@/lib/weft/labels";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------------------------
// Note types
// ---------------------------------------------------------------------------------------------

export interface MemoryTypeMeta {
  label: string;
  icon: LucideIcon;
}

export const MEMORY_TYPE_META: Record<MemoryNoteType, MemoryTypeMeta> = {
  org: { label: "Org", icon: Landmark },
  project: { label: "Project", icon: FolderKanban },
  system: { label: "System", icon: Boxes },
  team: { label: "Team", icon: Users },
  stakeholder: { label: "Stakeholder", icon: UserRound },
  decision: { label: "Decision", icon: Scale },
  convention: { label: "Convention", icon: ListChecks },
  kpi: { label: "KPI", icon: Gauge },
  glossary: { label: "Glossary", icon: BookA },
  document: { label: "Document", icon: FileText },
};

export interface MemoryTypeLabelProps {
  type: MemoryNoteType;
  className?: string;
  iconClassName?: string;
}

/** Icon + label for a note type (table cells, detail header, graph legend). */
export function MemoryTypeLabel({ type, className, iconClassName }: MemoryTypeLabelProps) {
  const meta = MEMORY_TYPE_META[type];
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <Icon aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground", iconClassName)} strokeWidth={2.25} />
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Type-group filter segments (All · Systems · People · Governance · Reference · Docs & projects)
// ---------------------------------------------------------------------------------------------

export { TYPE_GROUPS };

export const TYPES_BY_GROUP: Record<MemoryTypeGroup, readonly MemoryNoteType[]> = Object.fromEntries(
  TYPE_GROUPS.map((g) => [g.value, g.types]),
) as Record<MemoryTypeGroup, readonly MemoryNoteType[]>;

/**
 * SegmentedControl items for the type filter, with muted note counts per group when `byType` is
 * given (plan A3). Pass the result straight to `items`.
 */
export function typeGroupItems(byType?: Partial<Record<MemoryNoteType, number>>): Array<SegmentedItem<MemoryTypeGroup>> {
  return TYPE_GROUPS.map((g) => ({
    value: g.value,
    label: g.label,
    count: byType ? g.types.reduce((sum, t) => sum + (byType[t] ?? 0), 0) : undefined,
  }));
}

// ---------------------------------------------------------------------------------------------
// Note status (frontmatter `status`: active|proposed|deprecated|retired|signed-off|draft)
// ---------------------------------------------------------------------------------------------

export interface MemoryStatusMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

const STATUS_META: Record<string, MemoryStatusMeta> = {
  active: { label: "Active", tone: "success", icon: BadgeCheck },
  proposed: { label: "Proposed", tone: "review", icon: CircleDashed },
  draft: { label: "Draft", tone: "neutral", icon: PencilLine },
  deprecated: { label: "Deprecated", tone: "attention", icon: TriangleAlert },
  retired: { label: "Retired", tone: "neutral", icon: Archive },
  "signed-off": { label: "Signed off", tone: "success", icon: ShieldCheck },
};

/** Pill props for a note's status; unknown or absent status renders as a muted "No status". */
export function noteStatusMeta(status: string | null | undefined): MemoryStatusMeta {
  if (!status) return { label: "No status", tone: "neutral", icon: Minus };
  return STATUS_META[status] ?? { label: status, tone: "neutral", icon: Minus };
}

export interface NoteStatusPillProps {
  status: string | null | undefined;
  size?: "sm" | "md";
  className?: string;
}

export function NoteStatusPill({ status, size = "sm", className }: NoteStatusPillProps) {
  return <StatusPill {...noteStatusMeta(status)} size={size} className={className} />;
}

// ---------------------------------------------------------------------------------------------
// Origin (frontmatter `origin`: seed|document|manual)
// ---------------------------------------------------------------------------------------------

const ORIGIN_META: Record<string, { label: string; icon: LucideIcon; title: string }> = {
  seed: { label: "Seeded", icon: Sprout, title: "Created by the one-off knowledge seed" },
  document: { label: "From documents", icon: FileText, title: "Written by memory updates from signed-off documents" },
  manual: { label: "Manual", icon: PencilLine, title: "Edited by a person" },
};

export interface OriginChipProps {
  origin: string | undefined;
  size?: "sm" | "md";
  className?: string;
}

/** A muted outline chip naming where the note came from. Renders nothing without an origin. */
export function OriginChip({ origin, size = "sm", className }: OriginChipProps) {
  if (!origin) return null;
  const meta = ORIGIN_META[origin] ?? { label: origin, icon: Minus, title: `Origin: ${origin}` };
  return <StatusPill tone="neutral" variant="outline" icon={meta.icon} label={meta.label} title={meta.title} size={size} className={className} />;
}

// ---------------------------------------------------------------------------------------------
// Trust-signal pills (flags on notes and claims)
// ---------------------------------------------------------------------------------------------

export interface FlagPillProps {
  size?: "sm" | "md";
  className?: string;
}

/** The seed wrote this note as a stub because the secret scan hit. */
export function SeedBlockedPill({ size = "sm", className }: FlagPillProps) {
  return (
    <StatusPill
      tone="attention"
      icon={ShieldAlert}
      label="Seed blocked"
      title="Blocked by the secret scan at seed time; the note is a stub to fill in from the repository."
      size={size}
      className={className}
    />
  );
}

/** A `(proposed)` claim awaiting review, or a note with at least one. */
export function ProposedPill({ size = "sm", className }: FlagPillProps) {
  return <StatusPill tone="review" icon={CircleDashed} label="Proposed" title="Proposed and not yet reviewed" size={size} className={className} />;
}

/** A claim whose cited document drifted from its accepted sha. */
export function StaleSourcePill({ size = "sm", className, docId }: FlagPillProps & { docId?: string | null }) {
  return (
    <StatusPill
      tone="attention"
      icon={TriangleAlert}
      label="Stale source"
      title={docId ? `${docId} changed after it was signed off; this claim may be out of date.` : "The cited document changed after it was signed off."}
      size={size}
      className={className}
    />
  );
}

/** A document note whose signed-off file drifted from its accepted sha. */
export function StaleDocPill({ size = "sm", className }: FlagPillProps) {
  return (
    <StatusPill
      tone="attention"
      icon={TriangleAlert}
      label="Drifted"
      title="The signed-off file changed after acceptance; claims citing it may be out of date."
      size={size}
      className={className}
    />
  );
}

/** The pills a note's flags earn, in a stable order (table title cells, detail header). */
export function NoteFlagPills({ flags, size = "sm", className }: FlagPillProps & { flags: MemoryNoteFlags }) {
  if (!flags.seedBlocked && !flags.hasProposed && !flags.isStaleDoc) return null;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {flags.isStaleDoc && <StaleDocPill size={size} />}
      {flags.seedBlocked && <SeedBlockedPill size={size} />}
      {flags.hasProposed && <ProposedPill size={size} />}
    </span>
  );
}
