"use client";

/**
 * The /memory note table (plan A3, STYLE.md 6): every vault note with its trust pills, type,
 * category, status, update time, link and claim counts. Client-side: a type-group filter (the
 * shared segments from status-meta), a text filter over title/id/summary/aliases (prefilled from
 * `?q=`, which the note page's not-found state links to), and sorting by title, updated or links.
 * The whole row opens the note; the title is the link target.
 */
import { ArrowDown, ArrowUp, ArrowUpDown, BrainCircuit, Search, SearchX, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useId, useMemo, useState } from "react";
import { EmptyState, SectionCard, SegmentedControl } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { plural } from "@/lib/format";
import type { MemoryNoteCard, MemoryNoteListItem, MemoryNoteType, MemoryTypeGroup } from "@/lib/memory/types";
import { cn } from "@/lib/utils";
import { DayLabel, localDayMs } from "./day-label";
import { MemoryTypeLabel, NoteFlagPills, NoteStatusPill, TYPES_BY_GROUP, typeGroupItems } from "./status-meta";

type SortKey = "title" | "updated" | "links";
interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

/** First click on a header sorts the natural way: names A-Z, times and counts biggest first. */
const DEFAULT_DIR: Record<SortKey, "asc" | "desc"> = { title: "asc", updated: "desc", links: "desc" };

/** `card.updated` is an ISO `YYYY-MM-DD`; parsed once per compare (42 notes, cheap). */
function updatedMs(card: MemoryNoteCard): number {
  const ms = localDayMs(card.updated);
  return Number.isFinite(ms) ? ms : 0;
}

function SortHead({ label, k, sort, onSort, className }: { label: string; k: SortKey; sort: SortState; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort.key === k;
  return (
    <TableHead aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={className}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "group inline-flex items-center gap-1 rounded-sm outline-none transition-colors hover:text-heading focus-visible:ring-3 focus-visible:ring-ring/50",
          active && "text-heading",
        )}
      >
        {label}
        {active ? (
          sort.dir === "asc" ? (
            <ArrowUp aria-hidden className="size-3.5" />
          ) : (
            <ArrowDown aria-hidden className="size-3.5" />
          )
        ) : (
          <ArrowUpDown aria-hidden className="size-3.5 opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60" />
        )}
      </button>
    </TableHead>
  );
}

/** Case-, hyphen- and underscore-insensitive, so a slug (`customer-service`) finds "Customer Service". */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s_-]+/g, " ");
}

/** Muted zero, ink otherwise — claim counts are all zero today and should read as quiet, not broken. */
function CountCell({ n }: { n: number }) {
  return <span className={cn("tabular-nums", n === 0 ? "text-muted-foreground" : "text-heading")}>{n}</span>;
}

export interface MemoryNoteTableProps {
  notes: MemoryNoteListItem[];
  className?: string;
}

/**
 * `?q=` prefills the text filter. useSearchParams needs a Suspense boundary on a prerendered page;
 * the fallback is the same table without the prefill (in practice never shown: the table renders
 * only after the overview loads on the client, when the params are already known).
 */
export function MemoryNoteTable(props: MemoryNoteTableProps) {
  return (
    <Suspense fallback={<NoteTable {...props} initialQuery="" />}>
      <NoteTableFromUrl {...props} />
    </Suspense>
  );
}

function NoteTableFromUrl(props: MemoryNoteTableProps) {
  const initialQuery = useSearchParams().get("q") ?? "";
  // Keyed by the param, so following another ?q= link while on the page applies it.
  return <NoteTable key={initialQuery} {...props} initialQuery={initialQuery} />;
}

function NoteTable({ notes, className, initialQuery }: MemoryNoteTableProps & { initialQuery: string }) {
  const router = useRouter();
  const searchId = useId();
  const [group, setGroup] = useState<MemoryTypeGroup>("all");
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState<SortState>({ key: "updated", dir: "desc" });

  const byType = useMemo(() => {
    const m: Partial<Record<MemoryNoteType, number>> = {};
    for (const n of notes) m[n.card.type] = (m[n.card.type] ?? 0) + 1;
    return m;
  }, [notes]);

  const q = normalize(query.trim());
  const rows = useMemo(() => {
    const types = TYPES_BY_GROUP[group];
    let out = group === "all" ? notes : notes.filter((n) => types.includes(n.card.type));
    if (q) out = out.filter((n) => [n.card.title, n.card.id, n.card.summary, ...(n.card.props.aliases ?? [])].some((s) => normalize(s).includes(q)));
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      const d =
        sort.key === "title"
          ? a.card.title.localeCompare(b.card.title)
          : sort.key === "updated"
            ? updatedMs(a.card) - updatedMs(b.card)
            : a.linkCount - b.linkCount;
      return d !== 0 ? d * mul : a.card.title.localeCompare(b.card.title);
    });
  }, [notes, group, q, sort]);

  const onSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: DEFAULT_DIR[key] }));
  const filtered = group !== "all" || q !== "";

  if (notes.length === 0) {
    return (
      <SectionCard className={className}>
        <EmptyState
          icon={BrainCircuit}
          title="The vault has no notes yet"
          body="Notes appear once the knowledge seed runs or memory updates are applied from signed-off documents."
        />
      </SectionCard>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2.5" role="search" aria-label="Filter memory notes">
        <SegmentedControl<MemoryTypeGroup> aria-label="Filter by type group" value={group} onValueChange={setGroup} items={typeGroupItems(byType)} />
        <div className="relative w-full sm:w-72">
          <label htmlFor={searchId} className="sr-only">
            Search notes
          </label>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
          <Input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, summary or alias" className="pl-10" />
        </div>
        {filtered && (
          <Button
            variant="ghost"
            className="h-11 text-muted-foreground"
            onClick={() => {
              setGroup("all");
              setQuery("");
            }}
          >
            <X aria-hidden />
            Clear
          </Button>
        )}
      </div>

      <p className="px-1 text-sm text-muted-foreground" aria-live="polite">
        {rows.length === notes.length ? plural(notes.length, "note") : `${rows.length} of ${plural(notes.length, "note")}`}
      </p>

      <SectionCard flush bodyClassName="pt-2">
        {rows.length === 0 ? (
          <EmptyState icon={SearchX} title="No notes match these filters" body="Try another search or type group. The command palette searches claims and sections too." className="pb-6" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortHead label="Title" k="title" sort={sort} onSort={onSort} className="pl-5 sm:pl-7" />
                <TableHead>Type</TableHead>
                <TableHead className="hidden lg:table-cell">Category</TableHead>
                <TableHead className="hidden md:table-cell">Status</TableHead>
                <SortHead label="Updated" k="updated" sort={sort} onSort={onSort} className="hidden md:table-cell" />
                <SortHead label="Links" k="links" sort={sort} onSort={onSort} className="hidden text-right sm:table-cell" />
                <TableHead className="hidden pr-5 text-right sm:table-cell sm:pr-7">Claims</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((n) => {
                const href = `/memory/${n.card.id}`;
                return (
                  <TableRow
                    key={n.card.id}
                    className="h-12 cursor-pointer"
                    onClick={(e) => {
                      // Let the title link and modified clicks behave natively.
                      if ((e.target as HTMLElement).closest("a,button") || e.metaKey || e.ctrlKey || e.shiftKey) return;
                      router.push(href);
                    }}
                  >
                    <TableCell className="max-w-[16rem] py-3 pl-5 sm:max-w-[24rem] sm:pl-7">
                      <div className="flex min-w-0 items-center gap-2">
                        <Link
                          href={href}
                          title={n.card.summary || undefined}
                          className="min-w-0 truncate font-medium text-heading underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
                        >
                          {n.card.title}
                        </Link>
                        <NoteFlagPills flags={n.flags} className="shrink-0" />
                      </div>
                    </TableCell>
                    <TableCell>
                      <MemoryTypeLabel type={n.card.type} className="text-[13px] text-muted-foreground" />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">{n.card.props.category ?? "-"}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <NoteStatusPill status={n.card.status} />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      <DayLabel iso={n.card.updated} />
                    </TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      <CountCell n={n.linkCount} />
                    </TableCell>
                    <TableCell className="hidden pr-5 text-right sm:table-cell sm:pr-7">
                      <CountCell n={n.claimCount} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
