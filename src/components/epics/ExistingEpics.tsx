"use client";

/**
 * "Existing in Jira": dependencies discovery marked as a parent epic (e.g. CP-50894, CP-51709),
 * each with "Use as parent" for all epics without a parent or for one epic.
 */
import { ChevronDown, GitBranch } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useUpsertEpic } from "@/lib/api/queries";
import type { Dependency, Epic } from "@/lib/delivery/types";
import { KindBadge, RelationChip } from "../doc-stage/DependenciesList";

export function parentEpicDeps(deps: Dependency[]): Dependency[] {
  const seen = new Set<string>();
  return deps.filter((d) => /parent epic/i.test(d.relation) && !seen.has(d.ref) && seen.add(d.ref));
}

export function ExistingEpics({ projectId, parents, epics, readOnly }: { projectId: string; parents: Dependency[]; epics: Epic[]; readOnly?: boolean }) {
  const upsert = useUpsertEpic(projectId);
  const [busy, setBusy] = useState<string | null>(null);
  if (parents.length === 0) {
    return <p className="rounded-[20px] bg-well/60 px-4 py-8 text-center text-[13px] text-muted-foreground">Discovery found no parent epic in Jira for this project.</p>;
  }

  const apply = async (ref: string, targets: Epic[]) => {
    setBusy(ref);
    try {
      // Each save toasts "Epic saved" and invalidates the project, so the table updates live.
      for (const e of targets) await upsert.mutateAsync({ id: e.id, parentRef: ref });
    } catch {
      // The mutation already shows the error.
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="divide-y divide-rule border-y border-rule">
      {parents.map((d) => {
        const children = epics.filter((e) => e.parentRef === d.ref);
        const orphans = epics.filter((e) => !e.parentRef);
        return (
          <li key={d.ref} className="flex flex-col gap-2.5 px-1 py-3.5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-heading">{d.ref}</span>
                <KindBadge kind={d.kind} />
                <RelationChip relation={d.relation} />
                {children.length ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <GitBranch aria-hidden className="size-3" />
                    parent of {children.length} {children.length === 1 ? "epic" : "epics"}
                  </span>
                ) : null}
              </div>
              <p className="text-sm font-medium text-heading">{d.title}</p>
              {d.why ? <p className="text-[13px] leading-5 text-muted-foreground">{d.why}</p> : null}
            </div>
            {!readOnly && epics.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" className="w-fit shrink-0" disabled={busy !== null}>
                    {busy === d.ref ? "Saving…" : "Use as parent"}
                    <ChevronDown aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-w-80">
                  <DropdownMenuItem disabled={orphans.length === 0} onSelect={() => void apply(d.ref, orphans)}>
                    For all epics without a parent ({orphans.length})
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">One epic</DropdownMenuLabel>
                  {epics.map((e) => (
                    <DropdownMenuItem key={e.id} disabled={e.parentRef === d.ref} onSelect={() => void apply(d.ref, [e])}>
                      <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">{e.key ?? "draft"}</span>
                      <span className="truncate">{e.title}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
