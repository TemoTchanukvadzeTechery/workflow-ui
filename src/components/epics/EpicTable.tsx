"use client";

/**
 * Epics proposed from the BRD (and updated by the AAD): Key or "Not in Jira yet", Title, BR chips,
 * Objective, In scope count, Status, blocked-by chips and row actions. A table from ~672px of
 * container width, stacked cards below that, so it never scrolls the page sideways.
 */
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { StatusPill } from "@/components/common";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useDeleteEpic } from "@/lib/api/queries";
import type { Epic } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { BlockedBy, ChangedInArchitecture, EpicKey, ParentChip, RefChips } from "./EpicBits";

export interface EpicTableProps {
  projectId: string;
  epics: Epic[];
  /** BR-n → text, for chip tooltips. */
  brTexts?: Record<string, string>;
  /** FRn → text; shows an FR column (architecture). */
  frTexts?: Record<string, string>;
  showArchitecture?: boolean;
  readOnly?: boolean;
  onEdit?: (epic: Epic) => void;
  className?: string;
}

function InScope({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex h-6 items-center rounded-full bg-muted px-2 text-xs whitespace-nowrap tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label={`${items.length} in scope: ${items.join("; ")}`}>
            {items.length} {items.length === 1 ? "item" : "items"}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm flex-col items-start">
          <ul className="list-disc space-y-0.5 pl-4">
            {items.map((i, n) => (
              <li key={n}>{i}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function DeleteEpic({ projectId, epic }: { projectId: string; epic: Epic }) {
  const [open, setOpen] = useState(false);
  const del = useDeleteEpic(projectId);
  return (
    <>
      <Button variant="ghost" size="icon-sm" aria-label={`Delete epic ${epic.title}`} onClick={() => setOpen(true)} className="text-muted-foreground hover:text-destructive">
        <Trash2 aria-hidden />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this epic?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{epic.title}&rdquo;{epic.key ? ` (${epic.key})` : ""} is removed from this project. {epic.key ? "The mock Jira key is not reused." : "It was never created in Jira."} Its requirements are no longer covered by an epic.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="rounded-full"
              disabled={del.isPending}
              onClick={(e) => {
                e.preventDefault();
                del.mutate(epic.id, { onSuccess: () => setOpen(false) });
              }}
            >
              {del.isPending ? "Deleting…" : "Delete epic"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RowActions({ projectId, epic, onEdit, readOnly }: { projectId: string; epic: Epic; onEdit?: (e: Epic) => void; readOnly?: boolean }) {
  if (readOnly) return null;
  return (
    <div className="flex items-center justify-end gap-0.5">
      <Button variant="ghost" size="icon-sm" aria-label={`Edit epic ${epic.title}`} onClick={() => onEdit?.(epic)}>
        <Pencil aria-hidden />
      </Button>
      <DeleteEpic projectId={projectId} epic={epic} />
    </div>
  );
}

export function EpicTable({ projectId, epics, brTexts, frTexts, showArchitecture, readOnly, onEdit, className }: EpicTableProps) {
  return (
    <div className={cn("@container min-w-0", className)}>
      {/* Wide: a real table. */}
      <div className="relative hidden overflow-x-auto rounded-xl border border-border @2xl:block">
        <table className="w-full border-collapse text-[13px]">
          <caption className="sr-only">Epics</caption>
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="w-28 px-3 py-2 font-medium">Key</th>
              <th scope="col" className="px-3 py-2 font-medium">
                Title <span className="font-normal">· Objective</span>
              </th>
              <th scope="col" className="w-32 px-3 py-2 font-medium">{showArchitecture ? "BR / FR" : "Requirements"}</th>
              <th scope="col" className="w-20 px-3 py-2 font-medium">In scope</th>
              <th scope="col" className="w-28 px-3 py-2 font-medium">Status</th>
              {!readOnly ? <th scope="col" className="w-[4.5rem] px-2 py-2"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {epics.map((e) => (
              <tr key={e.id} className="h-10 border-t border-border align-top">
                <td className="px-3 py-2.5">
                  <EpicKey epic={e} />
                </td>
                <td className="px-3 py-2.5">
                  <div className="space-y-1">
                    <p className="font-medium leading-snug">{e.title}</p>
                    {e.objective ? (
                      <p className="line-clamp-2 text-xs leading-snug text-muted-foreground" title={e.objective}>
                        {e.objective}
                      </p>
                    ) : null}
                    {e.parentRef || (showArchitecture && e.changedIn === "architecture") ? (
                      <div className="flex flex-wrap gap-1">
                        <ParentChip parent={e.parentRef} />
                        {showArchitecture && e.changedIn === "architecture" ? <ChangedInArchitecture /> : null}
                      </div>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="space-y-1">
                    <RefChips refs={e.brdRequirementRefs} texts={brTexts} />
                    {showArchitecture && e.aadRefs.length ? <RefChips refs={e.aadRefs} texts={frTexts} tone="primary" /> : null}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <InScope items={e.inScope} />
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-col items-start gap-1">
                    <StatusPill status={{ kind: "epic", value: e.status }} size="sm" />
                    <BlockedBy ids={e.blockedBy} />
                  </div>
                </td>
                {!readOnly ? (
                  <td className="px-2 py-1.5">
                    <RowActions projectId={projectId} epic={e} onEdit={onEdit} readOnly={readOnly} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Narrow: stacked cards. */}
      <ul className="space-y-2 @2xl:hidden" aria-label="Epics">
        {epics.map((e) => (
          <li key={e.id} className="space-y-2 rounded-xl border border-border p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <EpicKey epic={e} />
                  <StatusPill status={{ kind: "epic", value: e.status }} size="sm" />
                  <BlockedBy ids={e.blockedBy} />
                </div>
                <p className="text-[13px] leading-snug font-medium">{e.title}</p>
              </div>
              <RowActions projectId={projectId} epic={e} onEdit={onEdit} readOnly={readOnly} />
            </div>
            {e.objective ? <p className="text-xs leading-snug text-muted-foreground">{e.objective}</p> : null}
            <div className="flex flex-wrap items-center gap-1.5">
              <RefChips refs={e.brdRequirementRefs} texts={brTexts} empty={null} />
              {showArchitecture ? <RefChips refs={e.aadRefs} texts={frTexts} tone="primary" empty={null} /> : null}
              <InScope items={e.inScope} />
              <ParentChip parent={e.parentRef} />
              {showArchitecture && e.changedIn === "architecture" ? <ChangedInArchitecture /> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
