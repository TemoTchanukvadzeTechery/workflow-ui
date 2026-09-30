"use client";

/**
 * Field-level before/after of an epic from its history: every history entry that carries a
 * `before` snapshot (the AAD update, a human edit) becomes a block listing, per field, what was
 * added and removed (lists) or the old and new text (strings). "After" is the value at the next
 * change of that field, or the epic's current value.
 */
import { ArrowRight } from "lucide-react";
import { actorText } from "@/components/common";
import { TimeAgo } from "@/components/hitl";
import type { Epic, EpicHistoryEntry, StageId } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";

type Field = keyof NonNullable<EpicHistoryEntry["before"]>;

/** Human edits snapshot any edited field, so labels cover more than the typed `before` keys. */
export const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  context: "Context",
  parentRef: "Parent epic",
  blockedBy: "Blocked by",
  objective: "Objective",
  inScope: "In scope",
  brdRequirementRefs: "BRD requirements",
  aadRefs: "AAD FRs",
  systems: "Systems",
  designElements: "Design elements",
};

const MONO: ReadonlySet<string> = new Set(["brdRequirementRefs", "aadRefs", "systems", "blockedBy"]);

export interface FieldChange {
  field: Field;
  before: unknown;
  after: unknown;
}

export interface DiffBlock {
  entry: EpicHistoryEntry;
  changes: FieldChange[];
}

/** History entries with before-snapshots, oldest first, each with its field changes resolved. */
export function epicDiffBlocks(epic: Epic, opts: { stage?: StageId } = {}): DiffBlock[] {
  const hist = epic.history;
  const blocks: DiffBlock[] = [];
  hist.forEach((entry, i) => {
    if (!entry.before || (opts.stage && entry.stage !== opts.stage)) return;
    const changes: FieldChange[] = [];
    for (const field of Object.keys(entry.before) as Field[]) {
      const before = entry.before[field];
      const nextEntry = hist.slice(i + 1).find((h) => h.before && field in h.before);
      const after = nextEntry ? nextEntry.before?.[field] : (epic as unknown as Record<string, unknown>)[field];
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      changes.push({ field, before, after });
    }
    if (changes.length) blocks.push({ entry, changes });
  });
  return blocks;
}

function asList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : v === undefined || v === null || v === "" ? [] : [String(v)];
}

function ListDiff({ change }: { change: FieldChange }) {
  const before = asList(change.before);
  const after = asList(change.after);
  const added = after.filter((x) => !before.includes(x));
  const removed = before.filter((x) => !after.includes(x));
  const kept = after.filter((x) => before.includes(x));
  const mono = MONO.has(change.field);
  const long = !mono;
  const item = (text: string, kind: "add" | "del" | "keep") =>
    long ? (
      <li
        key={`${kind}-${text}`}
        className={cn(
          "flex gap-2 rounded-[10px] px-2.5 py-1.5 text-[13px] leading-5",
          kind === "add" && "bg-status-success-bg text-foreground",
          kind === "del" && "bg-status-danger-bg text-muted-foreground line-through",
          kind === "keep" && "text-muted-foreground",
        )}
      >
        <span aria-hidden className={cn("w-3 shrink-0 font-mono", kind === "add" ? "text-status-success-fg" : kind === "del" ? "text-status-danger-fg" : "")}>
          {kind === "add" ? "+" : kind === "del" ? "−" : " "}
        </span>
        <span className="sr-only">{kind === "add" ? "Added: " : kind === "del" ? "Removed: " : "Unchanged: "}</span>
        <span className="min-w-0 break-words">{text}</span>
      </li>
    ) : (
      <li
        key={`${kind}-${text}`}
        className={cn(
          "inline-flex h-6 items-center rounded-[6px] px-1.5 font-mono text-[11.5px]",
          kind === "add" && "bg-status-success-bg text-status-success-fg",
          kind === "del" && "bg-status-danger-bg text-status-danger-fg line-through",
          kind === "keep" && "bg-foreground/[0.05] text-muted-foreground",
        )}
      >
        <span className="sr-only">{kind === "add" ? "Added: " : kind === "del" ? "Removed: " : "Unchanged: "}</span>
        {kind === "add" ? "+ " : ""}
        {text}
      </li>
    );
  return (
    <ul className={cn(long ? "space-y-0.5" : "flex flex-wrap gap-1")}>
      {kept.map((t) => item(t, "keep"))}
      {removed.map((t) => item(t, "del"))}
      {added.map((t) => item(t, "add"))}
    </ul>
  );
}

function TextChange({ change }: { change: FieldChange }) {
  return (
    <div className="grid gap-1.5 text-[13px] @xl:grid-cols-[1fr_auto_1fr] @xl:items-start">
      <p className="rounded-[10px] bg-status-danger-bg px-2.5 py-1.5 text-muted-foreground line-through">
        <span className="sr-only">Before: </span>
        {String(change.before ?? "") || "—"}
      </p>
      <ArrowRight aria-hidden className="mx-auto hidden size-4 text-muted-foreground @xl:block" />
      <p className="rounded-[10px] bg-status-success-bg px-2.5 py-1.5 text-foreground">
        <span className="sr-only">After: </span>
        {String(change.after ?? "") || "—"}
      </p>
    </div>
  );
}

export function EpicDiff({ epic, stage, className }: { epic: Epic; stage?: StageId; className?: string }) {
  const blocks = epicDiffBlocks(epic, { stage });
  if (blocks.length === 0) return <p className={cn("text-[13px] text-muted-foreground", className)}>No field changes recorded.</p>;
  return (
    <div className={cn("@container space-y-3", className)}>
      {blocks.map((b, i) => (
        <div key={i} className="space-y-2">
          <p className="text-[13px] text-muted-foreground">
            <span className="font-medium text-heading">{b.entry.change}</span> · {actorText(b.entry.by)} · <TimeAgo at={b.entry.at} />
          </p>
          <dl className="space-y-2">
            {b.changes.map((c) => (
              <div key={c.field} className="grid gap-1 @xl:grid-cols-[9rem_1fr] @xl:gap-3">
                <dt className="text-[13px] text-muted-foreground @xl:pt-1.5">{FIELD_LABEL[c.field] ?? c.field}</dt>
                <dd className="min-w-0">{Array.isArray(c.before) || Array.isArray(c.after) ? <ListDiff change={c} /> : <TextChange change={c} />}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
