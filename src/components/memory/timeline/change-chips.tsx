/**
 * What a vault commit changed, as small status pills (plan §4): notes added / changed / renamed /
 * removed, then claims added / promoted / edited / retired / removed, or why claims were not
 * counted. Icon + label on every pill, never color alone. Hook-free and server-compatible.
 */
import { Archive, CircleCheck, CircleDashed, FileMinus2, FilePen, FilePlus2, FileSymlink, ListPlus, ListX, PencilLine, type LucideIcon } from "lucide-react";
import { StatusPill } from "@/components/common";
import { formatNumber } from "@/lib/format";
import type { MemoryClaimCounts, MemoryClaimsAnalysed, MemoryTimelineTotals } from "@/lib/memory/types";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/weft/labels";

interface Chip {
  key: string;
  tone: Tone;
  icon: LucideIcon;
  label: string;
  title?: string;
}

const n = (value: number) => formatNumber(value);

function noteChips(t: MemoryTimelineTotals): Chip[] {
  const chips: Chip[] = [];
  if (t.notesAdded > 0) chips.push({ key: "added", tone: "success", icon: FilePlus2, label: `+${n(t.notesAdded)} ${t.notesAdded === 1 ? "note" : "notes"}` });
  if (t.notesChanged > 0) chips.push({ key: "changed", tone: "neutral", icon: FilePen, label: `${n(t.notesChanged)} changed` });
  if (t.notesRenamed > 0) chips.push({ key: "renamed", tone: "neutral", icon: FileSymlink, label: `${n(t.notesRenamed)} renamed` });
  if (t.notesRemoved > 0) chips.push({ key: "removed", tone: "danger", icon: FileMinus2, label: `${n(t.notesRemoved)} removed` });
  return chips;
}

const NOT_ANALYSED_TITLE: Partial<Record<MemoryClaimsAnalysed, string>> = {
  "too-large": "The commit changes more than 200,000 note lines, so its claims were not counted.",
  failed: "git could not produce the claim diff, so claims were not counted.",
};

function claimChips(c: MemoryClaimCounts, analysed: MemoryClaimsAnalysed): Chip[] {
  if (analysed === "too-large" || analysed === "failed") {
    return [{ key: "not-analysed", tone: "neutral", icon: CircleDashed, label: "Claims not analysed", title: NOT_ANALYSED_TITLE[analysed] }];
  }
  // A cut claim diff counts what it saw: a lower bound.
  const atLeast = analysed === "truncated" ? "≥" : "";
  const title = analysed === "truncated" ? "The claim diff was cut at 4 MB; the real counts may be higher." : undefined;
  const chips: Chip[] = [];
  if (c.added > 0) chips.push({ key: "c-added", tone: "success", icon: ListPlus, label: `+${atLeast}${n(c.added)} ${c.added === 1 ? "claim" : "claims"}`, title });
  if (c.promoted > 0) chips.push({ key: "c-promoted", tone: "success", icon: CircleCheck, label: `${atLeast}${n(c.promoted)} promoted`, title });
  if (c.edited > 0) chips.push({ key: "c-edited", tone: "neutral", icon: PencilLine, label: `${atLeast}${n(c.edited)} ${c.edited === 1 ? "claim" : "claims"} edited`, title });
  if (c.retired > 0) chips.push({ key: "c-retired", tone: "neutral", icon: Archive, label: `${atLeast}${n(c.retired)} retired`, title });
  if (c.removed > 0) chips.push({ key: "c-removed", tone: "danger", icon: ListX, label: `${atLeast}${n(c.removed)} ${c.removed === 1 ? "claim" : "claims"} removed`, title });
  return chips;
}

function Chips({ chips, className }: { chips: Chip[]; className?: string }) {
  if (chips.length === 0) return null;
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {chips.map((c) => (
        <StatusPill key={c.key} tone={c.tone} icon={c.icon} label={c.label} title={c.title} size="sm" />
      ))}
    </span>
  );
}

export interface ClaimChipsProps {
  counts: MemoryClaimCounts;
  analysed?: MemoryClaimsAnalysed;
  className?: string;
}

/** The claim pills alone (the note History card). Renders nothing when no claim changed. */
export function ClaimChips({ counts, analysed = "yes", className }: ClaimChipsProps) {
  return <Chips chips={claimChips(counts, analysed)} className={className} />;
}

export interface ChangeChipsProps {
  totals: MemoryTimelineTotals;
  claimsAnalysed: MemoryClaimsAnalysed;
  className?: string;
}

/** Note pills, then claim pills. Renders nothing for a commit that only touched other vault files. */
export function ChangeChips({ totals, claimsAnalysed, className }: ChangeChipsProps) {
  // "Claims not analysed" only matters on a commit that changed notes.
  const claims = totals.notesAdded + totals.notesChanged + totals.notesRemoved + totals.notesRenamed > 0 ? claimChips(totals.claims, claimsAnalysed) : [];
  return <Chips chips={[...noteChips(totals), ...claims]} className={className} />;
}
