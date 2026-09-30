"use client";

/**
 * Inbox, Linear style: everything waiting on a person across projects, in groups (Blocking a run,
 * Approvals, Ready to start, FYI), with the selected item on the right. Human requests are
 * answered in place; the next item then takes over, scrolled to its top, with a short "Answered;
 * next: <project>" so nobody acts on another project's request by accident. J/K moves, Enter
 * opens the item where it lives. On narrow screens the detail opens full width with a back button.
 */
import { CircleCheck, FolderKanban, Layers3, SearchX, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CardSkeleton, EmptyState, ErrorState, PageHeader, SectionCard, SegmentedControl, ToolbarGroup } from "@/components/common";
import { INBOX_GROUPS, inboxGroupMeta, itemGroup, orderByGroup, type InboxGroup } from "@/components/inbox/bits";
import { InboxDetail } from "@/components/inbox/InboxDetail";
import { inboxRowDomId, InboxList } from "@/components/inbox/InboxList";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useHotkey } from "@/hooks/use-hotkey";
import { useInbox } from "@/lib/api/queries";
import { STAGES, stageDef, type InboxItem, type StageId } from "@/lib/delivery/types";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Filters {
  project: string;
  stage: StageId | "all";
  group: InboxGroup | "all";
}

const NO_FILTERS: Filters = { project: "all", stage: "all", group: "all" };
const GROUP_OPTIONS: Array<{ value: Filters["group"]; label: string }> = [
  { value: "all", label: "All" },
  ...INBOX_GROUPS.map((g) => ({ value: g, label: g === "blocking_run" ? "Blocking" : inboxGroupMeta(g).label })),
];

function applyFilters(items: InboxItem[], f: Filters): InboxItem[] {
  return items.filter((i) => (f.project === "all" || i.projectId === f.project) && (f.stage === "all" || i.stage === f.stage) && (f.group === "all" || itemGroup(i) === f.group));
}

/** How long "Answered; next: …" stays up. */
const NOTICE_MS = 6_000;

export function InboxView() {
  const q = useInbox();
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  // The selected id, plus its last position so the next item takes over when it disappears
  // (answered, approved) instead of jumping back to the top.
  const [selection, setSelection] = useState<{ id?: string; index: number }>({ index: 0 });
  const [detailOpen, setDetailOpen] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  // The item answered in the detail pane, and the handover when it leaves the list and the next
  // item takes its place. The answer's success and the refreshed list can arrive in either order.
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  const [handover, setHandover] = useState<{ fromId: string; toId: string; text: string } | null>(null);
  const [shownId, setShownId] = useState<string | undefined>(undefined);

  const all = q.data ?? [];
  const items = orderByGroup(applyFilters(all, filters));
  const byId = items.findIndex((i) => i.id === selection.id);
  const index = byId >= 0 ? byId : Math.min(selection.index, items.length - 1);
  const selected = index >= 0 ? items[index] : undefined;

  if (selected?.id !== shownId) {
    const prev = shownId;
    setShownId(selected?.id);
    setHandover(prev && selected && !all.some((i) => i.id === prev) ? { fromId: prev, toId: selected.id, text: `Answered; next: ${selected.projectName} · ${stageDef(selected.stage).title}` } : null);
  }
  const notice = handover && handover.fromId === answeredId && handover.toId === selected?.id ? handover.text : null;

  // A new item in the pane starts at its top, not at the scroll position the last one left.
  const lastScrolled = useRef<string | undefined>(undefined);
  useEffect(() => {
    const id = selected?.id;
    if (!id || id === lastScrolled.current) return;
    const first = lastScrolled.current === undefined;
    lastScrolled.current = id;
    const el = detailRef.current;
    if (!first && el && el.getBoundingClientRect().top < 64) el.scrollIntoView({ block: "start" });
  }, [selected?.id]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setHandover(null), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [notice]);

  const projects = [...new Map(all.map((i) => [i.projectId, i.projectName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const filtered = filters.project !== "all" || filters.stage !== "all" || filters.group !== "all";
  const groupCount = (g: Filters["group"]) => applyFilters(all, { ...filters, group: g }).length;

  const select = (next: InboxItem | undefined, opts: { open?: boolean; scroll?: boolean } = {}) => {
    if (!next) return;
    const i = items.findIndex((x) => x.id === next.id);
    setSelection({ id: next.id, index: Math.max(0, i) });
    if (opts.open) {
      setDetailOpen(true);
      // Narrow layout: the detail replaces the list, so bring its top into view.
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "start" }));
    }
    if (opts.scroll) requestAnimationFrame(() => document.getElementById(inboxRowDomId(next.id))?.scrollIntoView({ block: "nearest" }));
  };

  const move = (delta: number) => {
    if (items.length === 0) return;
    const nextIndex = Math.min(items.length - 1, Math.max(0, (index < 0 ? -1 : index) + delta));
    select(items[nextIndex], { scroll: true });
    document.getElementById(inboxRowDomId(items[nextIndex].id))?.focus({ preventScroll: true });
  };

  const inDetail = (target: EventTarget | null) => target instanceof Node && !!detailRef.current?.contains(target);
  useHotkey("j", (e) => {
    if (inDetail(e.target)) return;
    e.preventDefault();
    move(1);
  });
  useHotkey("k", (e) => {
    if (inDetail(e.target)) return;
    e.preventDefault();
    move(-1);
  });
  useHotkey("enter", (e) => {
    // Enter inside the detail pane belongs to its form and buttons.
    if (!selected || inDetail(e.target)) return;
    const t = e.target as HTMLElement | null;
    if (t && t !== document.body && !t.id.startsWith("inbox-row-")) return;
    e.preventDefault();
    router.push(selected.href);
  });

  return (
    <div className="@container flex min-w-0 flex-col gap-5">
      <PageHeader
        title="Inbox"
        description="Runs paused for a person, gates and epics waiting for approval, work that is ready to start, and things worth knowing, across projects."
        actions={
          <p className="hidden items-center gap-1.5 text-[13px] text-muted-foreground @3xl:flex">
            <Kbd>J</Kbd>
            <Kbd>K</Kbd>
            <span>to move</span>
            <span aria-hidden>·</span>
            <Kbd>Enter</Kbd>
            <span>to open</span>
          </p>
        }
      >
        <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filter the inbox">
          <SegmentedControl
            aria-label="Group"
            value={filters.group}
            onValueChange={(v) => setFilters({ ...filters, group: v })}
            items={GROUP_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
              count: q.data ? groupCount(o.value) : undefined,
              countTone: o.value === "blocking_run" && q.data && groupCount(o.value) > 0 ? "attention" : undefined,
              ariaLabel: `${o.label}: ${q.data ? groupCount(o.value) : 0}`,
            }))}
          />
          <ToolbarGroup aria-label="Project and stage">
            <Select value={filters.project} onValueChange={(v) => setFilters({ ...filters, project: v })}>
              <SelectTrigger aria-label="Project" size="sm" className="max-w-56 sm:max-w-64">
                <FolderKanban aria-hidden className="size-4 text-heading" strokeWidth={1.75} />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projects.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.stage} onValueChange={(v) => setFilters({ ...filters, stage: v as Filters["stage"] })}>
              <SelectTrigger aria-label="Stage" size="sm">
                <Layers3 aria-hidden className="size-4 text-heading" strokeWidth={1.75} />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                {STAGES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.n}. {s.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ToolbarGroup>
          {filtered ? (
            <Button variant="ghost" className="h-11 text-muted-foreground" onClick={() => setFilters(NO_FILTERS)}>
              <X aria-hidden />
              Clear
            </Button>
          ) : null}
        </div>
      </PageHeader>

      {q.isPending ? (
        <InboxSkeleton />
      ) : q.error ? (
        <SectionCard>
          <ErrorState title="Could not load the inbox" error={q.error} onRetry={() => void q.refetch()} />
        </SectionCard>
      ) : all.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={CircleCheck}
            title="Nothing needs you right now"
            body="When an agent pauses for an answer, a stage waits for approval or a run fails, it shows up here."
          />
        </SectionCard>
      ) : items.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={SearchX}
            title="Nothing matches these filters"
            body={`${plural(all.length, "item")} waiting elsewhere.`}
            action={
              <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
                Clear filters
              </Button>
            }
          />
        </SectionCard>
      ) : (
        <div className="grid min-w-0 items-start gap-4 @4xl:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
          <nav
            aria-label="Inbox items"
            className={cn(
              "card-surface min-w-0 rounded-[28px] p-2.5 @4xl:sticky @4xl:top-4 @4xl:max-h-[calc(100vh-2rem)] @4xl:overflow-y-auto",
              detailOpen ? "hidden @4xl:block" : "block",
            )}
          >
            <p className="px-3 pt-2.5 text-[13px] text-muted-foreground" aria-live="polite">
              {filtered ? `${items.length} of ${plural(all.length, "item")}` : plural(all.length, "item")}
            </p>
            <InboxList items={items} selectedId={selected?.id} onSelect={(i) => select(i, { open: true })} />
          </nav>
          <div ref={detailRef} className={cn("min-w-0 scroll-mt-16 space-y-3", detailOpen ? "block" : "hidden @4xl:block")}>
            {notice ? (
              <p role="status" className="flex items-center gap-2 rounded-[16px] bg-status-success-bg px-4 py-2.5 text-sm text-status-success-fg">
                <CircleCheck aria-hidden className="size-4 shrink-0" />
                <span className="min-w-0">{notice}</span>
              </p>
            ) : null}
            {selected ? <InboxDetail key={selected.id} item={selected} onBack={() => setDetailOpen(false)} onAnswered={() => setAnsweredId(selected.id)} /> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function InboxSkeleton() {
  return (
    <div className="grid gap-4 @4xl:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]" aria-busy="true" aria-label="Loading the inbox">
      <div className="card-surface flex flex-col gap-4 rounded-[28px] p-5" aria-hidden>
        <Skeleton className="h-3 w-28" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
      <CardSkeleton rows={8} className="hidden @4xl:flex" />
    </div>
  );
}
