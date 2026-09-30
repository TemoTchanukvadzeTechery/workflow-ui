"use client";

import { useCommandState } from "cmdk";
import { FolderPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { StageIcon } from "@/components/common/stage-icon";
import { StatusDot, StatusPill } from "@/components/common/status";
import { toneClasses } from "@/components/common/tone";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { useHotkey } from "@/hooks/use-hotkey";
import { useInbox, useProjects, useRuns } from "@/lib/api/queries";
import { STAGES, stageDef } from "@/lib/delivery/types";
import { inboxItemText, projectStatusMeta, runStatusMeta, stageStatusMeta } from "@/lib/weft/labels";
import { inboxGroupMeta, itemGroup } from "../inbox/bits";
import { NAV_ITEMS } from "./nav";
import { closeCommandPalette, openCommandPalette, setCommandPaletteSearch, toggleCommandPalette, useCommandPaletteState } from "./palette-store";

/**
 * The surface: a card-radius sheet of --card with the card edge and a deep lift, a 44px white
 * search field, 12px-radius rows that select to the well color. Descendant selectors because the
 * cmdk wrappers in ui/command are shared with other comboboxes.
 */
const DIALOG_CLS = [
  "top-[14vh] gap-0 rounded-[24px]! bg-card p-0 sm:max-w-[640px]",
  "shadow-[0_0_0_1px_rgba(0,0,0,.05),0_32px_80px_-24px_rgba(0,0,0,.35),inset_0_1px_0_rgba(255,255,255,.9)] ring-0!",
  "dark:shadow-[0_0_0_1px_rgba(255,255,255,.08),0_32px_80px_-24px_rgba(0,0,0,.7)]",
].join(" ");

const COMMAND_CLS = [
  "rounded-none! bg-transparent p-0",
  "**:data-[slot=command-input-wrapper]:p-3 **:data-[slot=command-input-wrapper]:pb-2",
  "**:data-[slot=input-group]:h-11! **:data-[slot=input-group]:rounded-[14px]! **:data-[slot=input-group]:border-[#E6E6E6] **:data-[slot=input-group]:bg-white **:data-[slot=input-group]:shadow-[0_1px_2px_rgba(0,0,0,.04)]!",
  "dark:**:data-[slot=input-group]:border-white/10 dark:**:data-[slot=input-group]:bg-white/5",
  "**:data-[slot=input-group-addon]:pl-3.5! **:data-[slot=command-input]:text-[15px]",
  "**:data-[slot=command-item]:min-h-10 **:data-[slot=command-item]:rounded-xl! **:data-[slot=command-item]:px-3 **:data-[slot=command-item]:text-[14px]",
  "**:data-[slot=command-item]:data-selected:bg-[#EDEDED] dark:**:data-[slot=command-item]:data-selected:bg-white/8",
  "**:data-[slot=command-group]:px-2 **:[[cmdk-group-heading]]:px-3! **:[[cmdk-group-heading]]:pt-2.5! **:[[cmdk-group-heading]]:text-[12px]! **:[[cmdk-group-heading]]:font-normal!",
  "**:data-[slot=command-separator]:mx-3 **:data-[slot=command-separator]:bg-border/70",
].join(" ");

const KBD_CLS = "h-5 rounded-md bg-[#EAEAEA] px-1.5 font-mono text-[10.5px] text-foreground/70 dark:bg-white/10";

/**
 * The one Cmd/Ctrl+K palette: pages, projects, stages (while searching), recent runs and inbox
 * items. Mounted once by the shell; open it from anywhere with `openCommandPalette(text?)`.
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
    router.push(href);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => (next ? openCommandPalette(search) : closeCommandPalette())}
      title="Search"
      description="Jump to a page, project, stage, run or inbox item"
      className={DIALOG_CLS}
    >
      <Command loop className={COMMAND_CLS}>
        <CommandInput value={search} onValueChange={setCommandPaletteSearch} placeholder="Search projects, stages, runs, inbox..." />
        {/* Mounted only while open, so the queries below run on demand. */}
        <PaletteBody go={go} />
        <div className="flex items-center gap-4 border-t border-border/70 px-5 py-3 text-[12px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Kbd className={KBD_CLS}>Enter</Kbd> open
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd className={KBD_CLS}>Up</Kbd>
            <Kbd className={KBD_CLS}>Down</Kbd> move
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <Kbd className={KBD_CLS}>Esc</Kbd> close
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
        No page, project, stage, run or inbox item matches <span className="text-foreground">&ldquo;{search.trim()}&rdquo;</span>.
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
