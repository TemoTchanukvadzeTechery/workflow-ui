"use client";

import { defaultFilter, useCommandState } from "cmdk";
import { BrainCircuit, CircleAlert, FolderPlus, Loader2, TextQuote } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { StageIcon } from "@/components/common/stage-icon";
import { StatusDot, StatusPill } from "@/components/common/status";
import { toneClasses } from "@/components/common/tone";
import { MEMORY_TYPE_META } from "@/components/memory/status-meta";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { useHotkey } from "@/hooks/use-hotkey";
import { useInbox, useMemorySearch, useProjects, useRuns } from "@/lib/api/queries";
import { STAGES, stageDef } from "@/lib/delivery/types";
import type { MemorySearchHit, MemorySearchPayload } from "@/lib/memory/types";
import { inboxItemText, projectStatusMeta, runStatusMeta, stageStatusMeta } from "@/lib/weft/labels";
import { inboxGroupMeta, itemGroup } from "../inbox/bits";
import { NAV_ITEMS } from "./nav";
import { closeCommandPalette, openCommandPalette, setCommandPaletteSearch, toggleCommandPalette, useCommandPaletteState } from "./palette-store";

/** Wider than ui/command's default and higher on the screen, with room between groups. */
const DIALOG_CLS = "top-[14vh] sm:max-w-[640px]";
const COMMAND_CLS = "p-2 **:data-[slot=command-group]:px-1 **:data-[slot=command-separator]:mx-2 **:data-[slot=command-separator]:my-1";

/** Memory search starts at this many characters; below it every hit would be noise. */
const MEMORY_MIN_CHARS = 2;
const MEMORY_DEBOUNCE_MS = 250;
const MEMORY_LIMIT = 8;
/** Every memory item's cmdk value starts with this, so paletteFilter can tell them apart. */
const MEMORY_VALUE = "memory:";
/**
 * The score memory items get from paletteFilter: below a word-start match of a page, project or
 * stage (~0.9), above cmdk's weak fuzzy matches, so the group sorts among the others sensibly.
 */
const MEMORY_SCORE = 0.5;

/**
 * cmdk's default filter, except for memory hits: they come ranked from the vault's hybrid search
 * (full text plus embeddings) and often match without containing the typed letters, so they all
 * pass with one equal score and keep the server's order (cmdk's sort is stable).
 */
function paletteFilter(value: string, search: string, keywords?: string[]): number {
  return value.startsWith(MEMORY_VALUE) ? MEMORY_SCORE : defaultFilter(value, search, keywords);
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * The one Cmd/Ctrl+K palette: pages, projects, stages and memory notes (while searching), recent
 * runs and inbox items. Mounted once by the shell; open it from anywhere with `openCommandPalette(text?)`.
 */
export function CommandPalette() {
  const { open, search } = useCommandPaletteState();
  const router = useRouter();

  useHotkey(
    "k",
    (e) => {
      e.preventDefault();
      toggleCommandPalette();
    },
    { mod: true },
  );

  const go = (href: string) => {
    closeCommandPalette();
    // A claim of the note already open (`/memory/<note>#c-hex` from here): router.push changes
    // only history, so no hashchange reaches the page and the claim is not ringed. Assigning the
    // hash is a native fragment navigation that fires it.
    const url = new URL(href, window.location.href);
    if (url.hash && url.pathname === window.location.pathname && url.search === window.location.search) {
      window.location.hash = url.hash;
      return;
    }
    router.push(href);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => (next ? openCommandPalette(search) : closeCommandPalette())}
      title="Search"
      description="Jump to a page, project, stage, run, inbox item or memory note"
      className={DIALOG_CLS}
    >
      <Command loop filter={paletteFilter} className={COMMAND_CLS}>
        <CommandInput value={search} onValueChange={setCommandPaletteSearch} placeholder="Search projects, stages, runs, inbox, memory..." />
        {/* Mounted only while open, so the queries below run on demand. */}
        <PaletteBody go={go} />
        <div className="-mx-2 -mb-2 flex items-center gap-4 border-t border-rule px-5 py-3 text-[12px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Kbd>Enter</Kbd> open
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Up</Kbd>
            <Kbd>Down</Kbd> move
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <Kbd>Esc</Kbd> close
          </span>
        </div>
      </Command>
    </CommandDialog>
  );
}

function PaletteBody({ go }: { go: (href: string) => void }) {
  const search = useCommandState((s) => s.search);
  const searching = search.trim().length > 0;
  const projects = useProjects();
  const runs = useRuns({ limit: 20 });
  const inbox = useInbox();

  const projectList = projects.data ?? [];
  const runList = runs.data ?? [];
  const inboxList = inbox.data ?? [];

  return (
    <CommandList className="max-h-[min(60vh,28rem)] pb-2">
      <CommandEmpty className="px-6 py-10 text-[14px] text-muted-foreground">
        No page, project, stage, run, inbox item or memory note matches <span className="text-heading">&ldquo;{search.trim()}&rdquo;</span>.
      </CommandEmpty>

      <CommandGroup heading="Pages">
        {NAV_ITEMS.map((n) => (
          <CommandItem key={n.href} value={`page ${n.title}`} onSelect={() => go(n.href)}>
            <n.icon aria-hidden className="text-muted-foreground" />
            {n.title}
          </CommandItem>
        ))}
        <CommandItem value="page new project create intake" onSelect={() => go("/projects/new")}>
          <FolderPlus aria-hidden className="text-muted-foreground" />
          New project
        </CommandItem>
      </CommandGroup>

      {projectList.length > 0 && (
        <>
          <CommandSeparator />
          <CommandGroup heading="Projects">
            {projectList.map((p) => {
              const meta = projectStatusMeta(p);
              return (
                <CommandItem key={p.id} value={`project ${p.name} ${p.key} ${p.id}`} onSelect={() => go(`/projects/${p.id}`)}>
                  <StatusDot tone={meta.tone} pulse={meta.pulse} className="mx-1" />
                  <span className="truncate">{p.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{p.done ? "Done" : stageDef(p.currentStage).title}</span>
                  <CommandShortcut className="font-mono tracking-normal">{p.key}</CommandShortcut>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </>
      )}

      {/* 5 stages per project is too long for the idle list; offer them once the user types. */}
      {searching && projectList.length > 0 && (
        <>
          <CommandSeparator />
          <CommandGroup heading="Stages">
            {projectList.flatMap((p) =>
              STAGES.map((s) => {
                const status = p.stageStatuses[s.id];
                return (
                  <CommandItem key={`${p.id}:${s.id}`} value={`stage ${p.name} ${p.key} ${s.title} ${s.short} ${s.owner}`} onSelect={() => go(`/projects/${p.id}/${s.id}`)}>
                    <StageIcon stage={s.id} className="text-muted-foreground" />
                    <span className="truncate">
                      {p.name} <span className="text-muted-foreground">/ {s.title}</span>
                    </span>
                    {status && (
                      <CommandShortcut className="tracking-normal">
                        <StatusPill {...stageStatusMeta(status)} size="sm" variant="plain" />
                      </CommandShortcut>
                    )}
                  </CommandItem>
                );
              }),
            )}
          </CommandGroup>
        </>
      )}

      <MemoryGroup search={search} go={go} />

      {inboxList.length > 0 && (
        <>
          <CommandSeparator />
          <CommandGroup heading="Inbox">
            {(searching ? inboxList : inboxList.slice(0, 5)).map((item) => {
              const group = inboxGroupMeta(itemGroup(item));
              const text = inboxItemText(item);
              return (
                <CommandItem key={item.id} value={`inbox ${item.id} ${text} ${item.projectName} ${group.label}`} onSelect={() => go(item.href)}>
                  <group.icon aria-hidden className={group.tone === "neutral" ? "text-muted-foreground" : toneClasses(group.tone).text} />
                  <span className="min-w-0 flex-1 truncate">{text}</span>
                  <span className="max-w-[35%] shrink-0 truncate text-xs text-muted-foreground">{item.projectName}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </>
      )}

      {runList.length > 0 && (
        <>
          <CommandSeparator />
          <CommandGroup heading="Recent runs">
            {(searching ? runList : runList.slice(0, 5)).map((r) => {
              const meta = runStatusMeta(r.status);
              return (
                <CommandItem key={r.runId} value={`run ${r.runId} ${r.workflow} ${meta.label}`} onSelect={() => go(`/runs/${r.runId}`)}>
                  <StatusDot tone={meta.tone} pulse={meta.pulse} className="mx-1" />
                  <span className="font-mono text-xs">{r.workflow}</span>
                  <span className="font-mono text-xs text-muted-foreground">{r.runId}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{meta.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </>
      )}
    </CommandList>
  );
}

/** Where a hit opens: the note, or the owning note scrolled to the claim (`#c-<hex>`). Null if neither is known. */
function memoryHitHref(hit: MemorySearchHit): string | null {
  if (hit.kind === "card") return `/memory/${hit.id}`;
  if (!hit.note) return null;
  return hit.kind === "claim" ? `/memory/${hit.note}#${hit.id}` : `/memory/${hit.note}`;
}

/**
 * Vault notes and claims for the typed text (plan A2), from the memory CLI's hybrid search,
 * debounced so each pause is one search. Rendered only while searching, like Stages. The last
 * results stay up while the next search runs (a spinner in the heading says so); with nothing to
 * show yet, a disabled row says memory is being searched, which also keeps "No ... matches" from
 * showing before memory has answered.
 */
function MemoryGroup({ search, go }: { search: string; go: (href: string) => void }) {
  const typed = search.trim();
  const q = useDebounced(typed, MEMORY_DEBOUNCE_MS);
  const active = typed.length >= MEMORY_MIN_CHARS;
  const res = useMemorySearch(q, { enabled: active && q.length >= MEMORY_MIN_CHARS, limit: MEMORY_LIMIT });

  // The last answer, shown while the next query is debounced or in flight (React's "store
  // information from previous renders" pattern). Dropped once the text is too short again.
  const [last, setLast] = useState<MemorySearchPayload | undefined>(undefined);
  if (active && res.data && res.data !== last) setLast(res.data);
  if (!active && last) setLast(undefined);

  if (!active) return null;
  const pending = typed !== q || res.isPending;
  const payload = res.data ?? last;
  const seen = new Set<string>();
  const hits = (payload?.hits ?? []).filter((hit) => {
    const key = `${hit.kind}:${hit.id}`;
    if (!memoryHitHref(hit) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const failed = !pending && !!res.error;
  if (!pending && !failed && hits.length === 0) return null;

  return (
    <>
      <CommandSeparator />
      <CommandGroup
        heading={
          <span className="inline-flex items-center gap-1.5">
            Memory
            {pending && hits.length > 0 ? <Loader2 aria-hidden className="size-3 animate-spin" /> : null}
          </span>
        }
      >
        {failed ? (
          <CommandItem disabled value={`${MEMORY_VALUE}status`} className="text-muted-foreground data-[disabled=true]:opacity-100">
            <CircleAlert aria-hidden className="text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">Memory search is unavailable: {res.error?.message}</span>
          </CommandItem>
        ) : hits.length === 0 ? (
          <CommandItem disabled value={`${MEMORY_VALUE}status`} className="text-muted-foreground data-[disabled=true]:opacity-100">
            <Loader2 aria-hidden className="animate-spin text-muted-foreground" />
            Searching the memory vault...
          </CommandItem>
        ) : (
          hits.map((hit) => <MemoryHitItem key={`${hit.kind}:${hit.id}`} hit={hit} go={go} />)
        )}
      </CommandGroup>
    </>
  );
}

function MemoryHitItem({ hit, go }: { hit: MemorySearchHit; go: (href: string) => void }) {
  const href = memoryHitHref(hit) ?? "/memory";
  const typeMeta = hit.type ? MEMORY_TYPE_META[hit.type] : undefined;
  if (hit.kind === "claim") {
    // A claim: its text, then the note it belongs to. The quote icon (not color) marks it as a claim.
    return (
      <CommandItem value={`${MEMORY_VALUE}claim:${hit.id}`} onSelect={() => go(href)}>
        <TextQuote aria-hidden className="text-muted-foreground" />
        <span className="sr-only">Claim: </span>
        <span className="min-w-0 flex-1 truncate">{hit.snippet || hit.id}</span>
        <CommandShortcut className="max-w-[40%] shrink-0 truncate font-mono tracking-normal">{hit.note}</CommandShortcut>
      </CommandItem>
    );
  }
  const Icon = typeMeta?.icon ?? BrainCircuit;
  const id = hit.kind === "card" ? hit.id : (hit.note ?? hit.id);
  return (
    <CommandItem value={`${MEMORY_VALUE}${hit.kind}:${hit.id}`} onSelect={() => go(href)}>
      <Icon aria-hidden className="text-muted-foreground" />
      {typeMeta ? <span className="sr-only">{typeMeta.label}: </span> : null}
      <span className="min-w-0 truncate">{hit.title || id}</span>
      {hit.kind === "section" && hit.heading ? <span className="min-w-0 truncate text-xs text-muted-foreground">§ {hit.heading}</span> : null}
      <CommandShortcut className="max-w-[45%] shrink-0 truncate pl-2 font-mono tracking-normal">{id}</CommandShortcut>
    </CommandItem>
  );
}
