"use client";

/**
 * Stage 2 · Epic updates (brief C.2, SPEC decision 7). When the AAD is accepted the orchestrator
 * fills each epic's FR refs and design elements from the AAD's functional-requirement table and
 * its systems from the High-Level Architecture table, and may add epics. Each changed epic shows
 * a "Changed in Architecture" badge and a field-level before/after diff; a person reviews, edits
 * and accepts the updates, and new epics can be created in Jira (mock).
 */
import { ChevronDown, CloudUpload, ListChecks, Network, Pencil, Plus, SquareStack } from "lucide-react";
import { useState } from "react";
import { actorText, EmptyState, SectionCard, StatusPill } from "@/components/common";
import { Notice, TimeAgo } from "@/components/hitl";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAcceptEpics, useSyncEpics } from "@/lib/api/queries";
import type { Epic, ProjectBundle } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { stageDoc } from "../doc-stage/run-utils";
import { BlockedBy, ChangedInArchitecture, EpicKey, MockJiraBanner, ParentChip, RefChips, refTexts } from "./EpicBits";
import { EpicDiff, epicDiffBlocks } from "./EpicDiff";
import { isParked, questionOptions } from "./EpicsPanel";
import { EpicSheet, type RefOption } from "./EpicSheet";

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 @lg:grid-cols-[8.5rem_1fr] @lg:items-start @lg:gap-3">
      <span className="text-[13px] text-muted-foreground @lg:pt-0.5">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function PlainChips({ items, mono, empty = "—" }: { items: string[]; mono?: boolean; empty?: string }) {
  if (items.length === 0) return <span className="text-[13px] text-muted-foreground">{empty}</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {items.map((s) => (
        <li key={s} className={cn("inline-flex min-h-6 max-w-full items-center rounded-full bg-well px-2.5 py-0.5 text-xs leading-tight break-words text-heading", mono && "font-mono text-[11.5px]")}>
          {s}
        </li>
      ))}
    </ul>
  );
}

function EpicUpdateCard({ epic, brTexts, frTexts, onEdit, readOnly, reviewed }: { epic: Epic; brTexts: Record<string, string>; frTexts: Record<string, string>; onEdit: () => void; readOnly?: boolean; reviewed?: boolean }) {
  const blocks = epicDiffBlocks(epic, { stage: "architecture" });
  const isNew = epic.origin === "architecture";
  const changed = epic.changedIn === "architecture" || blocks.length > 0;
  // Expanded while the updates wait for review; collapsed once they are accepted (also live, on "Accept epic updates").
  const [open, setOpen] = useState(changed && !reviewed);
  const [wasReviewed, setWasReviewed] = useState(reviewed);
  if (reviewed !== wasReviewed) {
    setWasReviewed(reviewed);
    setOpen(changed && !reviewed);
  }
  return (
    <li className="@container rounded-[20px] bg-field shadow-[0_0_0_1px_var(--rule),0_1px_2px_rgb(0_0_0/0.03)]">
      <div className="flex items-start gap-2 p-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <EpicKey epic={epic} />
            <StatusPill status={{ kind: "epic", value: epic.status }} size="sm" />
            {isNew ? <StatusPill tone="running" icon={Plus} label="New in Architecture" size="sm" /> : changed ? <ChangedInArchitecture /> : <StatusPill tone="neutral" icon={null} label="No change" size="sm" />}
            <BlockedBy ids={epic.blockedBy} />
            <ParentChip parent={epic.parentRef} />
          </div>
          <p className="text-[15px] leading-6 font-medium text-heading">{epic.title}</p>
          {epic.objective ? <p className="text-[13px] leading-5 text-muted-foreground">{epic.objective}</p> : null}
        </div>
        {!readOnly ? (
          <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label={`Edit epic ${epic.title}`} onClick={onEdit}>
            <Pencil aria-hidden />
          </Button>
        ) : null}
      </div>
      <div className="space-y-2.5 border-t border-rule px-4 py-3">
        <ChipRow label="BRD requirements">
          <RefChips refs={epic.brdRequirementRefs} texts={brTexts} />
        </ChipRow>
        <ChipRow label="AAD FRs">
          <RefChips refs={epic.aadRefs} texts={frTexts} tone="primary" />
        </ChipRow>
        <ChipRow label="Systems">
          <PlainChips items={epic.systems} mono />
        </ChipRow>
        <ChipRow label="Design elements">
          <PlainChips items={epic.designElements} />
        </ChipRow>
      </div>
      {blocks.length > 0 ? (
        <Collapsible open={open} onOpenChange={setOpen} className="border-t border-rule">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-h-10 w-full items-center gap-1.5 rounded-b-[20px] px-4 py-2 text-left text-[13px] font-medium text-muted-foreground hover:text-heading focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <ChevronDown aria-hidden className={cn("size-3.5 transition-transform duration-150", !open && "-rotate-90")} />
              {open ? "Hide" : "Show"} what changed ({blocks.reduce((n, b) => n + b.changes.length, 0)} {blocks.reduce((n, b) => n + b.changes.length, 0) === 1 ? "field" : "fields"})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="px-4 pb-4">
            <EpicDiff epic={epic} stage="architecture" />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </li>
  );
}

export function EpicUpdatesPanel({ projectId, bundle, readOnly }: { projectId: string; bundle: ProjectBundle; readOnly?: boolean }) {
  const aad = stageDoc(bundle, "aad");
  const brd = stageDoc(bundle, "brd");
  const record = bundle.project.stages.architecture;
  const epics = bundle.epics;
  const [sheet, setSheet] = useState<{ open: boolean; epic?: Epic }>({ open: false });
  const accept = useAcceptEpics(projectId);
  const sync = useSyncEpics(projectId);
  const acceptedAt = record.epicUpdatesAcceptedAt;
  const drafts = epics.filter((e) => e.status === "draft" && !isParked(e));
  const toSync = epics.filter((e) => e.status === "accepted" && !e.key);
  const changed = epics.filter((e) => e.changedIn === "architecture" || epicDiffBlocks(e, { stage: "architecture" }).length > 0);
  const added = epics.filter((e) => e.origin === "architecture");
  const brTexts = refTexts(brd?.requirements);
  const frTexts = refTexts(aad?.frs);
  const sorted = [...epics].sort((a, b) => Number(b.changedIn === "architecture") - Number(a.changedIn === "architecture"));
  const accepter = acceptedAt ? [...bundle.activity].reverse().find((a) => a.stage === "architecture" && /accepted the epic updates/.test(a.text)) : undefined;

  if (aad?.status !== "accepted") {
    return (
      <SectionCard density="dense">
        <EmptyState
          icon={Network}
          title="Epic updates come from the accepted AAD"
          body="Once you accept the AAD, its functional requirements, design elements and system changes are written onto the epics here, with a before/after for every change, for you to review and accept."
        />
      </SectionCard>
    );
  }

  const frs: RefOption[] = (aad.frs ?? []).map((f) => ({ id: f.id, text: f.text, ...(f.traces.length ? { hint: ` · ${f.traces.join(", ")}` } : {}) }));
  const requirements: RefOption[] = (brd?.requirements ?? []).map((r) => ({ id: r.id, text: r.text, ...(r.candidate ? { hint: " · candidate" } : {}) }));
  const parents = (brd?.dependencies ?? []).filter((d) => /parent epic/i.test(d.relation)).map((d) => ({ ref: d.ref, title: d.title }));

  return (
    <div className="space-y-5">
      <MockJiraBanner />
      <SectionCard
        density="dense"
        title="Epic updates from the AAD"
        description={`${changed.length} of ${epics.length} ${epics.length === 1 ? "epic" : "epics"} changed in Architecture${added.length ? ` · ${added.length} new` : ""}. FRs and design elements come from the Functional Requirements table, systems from the High-Level Architecture table.`}
        actions={
          !readOnly ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setSheet({ open: true })}>
                Add epic
                <Plus aria-hidden />
              </Button>
              {!acceptedAt && epics.length > 3 ? (
                <Button disabled={accept.isPending} onClick={() => accept.mutate("architecture")}>
                  <ListChecks aria-hidden />
                  Accept epic updates
                </Button>
              ) : null}
            </div>
          ) : null
        }
      >
        <div className="space-y-4">
          {acceptedAt ? (
            <Notice tone="success" icon={ListChecks} role="status">
              Epic updates accepted{accepter ? ` by ${actorText(accepter.actor)}` : ""} <TimeAgo at={acceptedAt} />.
              {drafts.length ? ` ${drafts.length} ${drafts.length === 1 ? "epic was" : "epics were"} added or reopened since; accept again to include ${drafts.length === 1 ? "it" : "them"}.` : ""}
            </Notice>
          ) : null}
          {epics.length === 0 ? (
            <EmptyState size="sm" icon={SquareStack} title="No epics" body="The project has no epics. Add one per system or feature area." />
          ) : (
            <ul className="space-y-3" aria-label="Epics">
              {sorted.map((e) => (
                <EpicUpdateCard key={e.id} epic={e} brTexts={brTexts} frTexts={frTexts} readOnly={readOnly} reviewed={!!acceptedAt} onEdit={() => setSheet({ open: true, epic: e })} />
              ))}
            </ul>
          )}

          {!readOnly ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-4">
              <Button disabled={(!!acceptedAt && drafts.length === 0) || accept.isPending} onClick={() => accept.mutate("architecture")}>
                <ListChecks aria-hidden />
                {accept.isPending ? "Accepting…" : acceptedAt && drafts.length === 0 ? "Epic updates accepted" : "Accept epic updates"}
              </Button>
              {toSync.length > 0 ? (
                <Button variant={acceptedAt ? "default" : "secondary"} disabled={sync.isPending} onClick={() => sync.mutate()}>
                  <CloudUpload aria-hidden />
                  {sync.isPending ? "Creating…" : `Create ${toSync.length} in Jira`}
                </Button>
              ) : null}
              <span className="text-[13px] text-muted-foreground">
                {!acceptedAt ? `Accepts the AAD's changes on every epic${drafts.length ? ` and ${drafts.length} new ${drafts.length === 1 ? "epic" : "epics"}` : ""}.` : toSync.length ? `New epics get keys from ${bundle.project.jiraProject} (mock).` : ""}
              </span>
            </div>
          ) : null}
        </div>
      </SectionCard>

      <EpicSheet
        projectId={projectId}
        open={sheet.open}
        onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))}
        epic={sheet.epic}
        requirements={requirements}
        frs={frs}
        questions={questionOptions(aad).length ? questionOptions(aad) : questionOptions(brd)}
        parents={parents}
        architecture
      />
    </div>
  );
}
