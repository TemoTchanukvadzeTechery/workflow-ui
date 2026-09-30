"use client";

/**
 * Stage 1 Epics (SPEC decision 7): epics proposed from the accepted BRD, edited by a person,
 * accepted together, then created in Jira by the mock (keys CP-52140…). Epics blocked by an open
 * question stay draft. "Existing in Jira" lists parent epics discovery found.
 */
import { Check, CloudUpload, ListChecks, Plus, SquareStack } from "lucide-react";
import { useState } from "react";
import { EmptyState, SectionCard } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useAcceptEpics, useSyncEpics } from "@/lib/api/queries";
import type { Epic, ProjectBundle } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { stageDoc } from "../doc-stage/run-utils";
import { MockJiraBanner, refTexts } from "./EpicBits";
import { EpicSheet, type RefOption } from "./EpicSheet";
import { EpicTable } from "./EpicTable";
import { ExistingEpics, parentEpicDeps } from "./ExistingEpics";

export const isParked = (e: Epic) => e.status === "draft" && !!e.blockedBy?.length;

type StepState = "done" | "current" | "todo";

function FlowStep({ n, label, state, detail }: { n: number; label: string; state: StepState; detail?: string }) {
  return (
    <li className="flex min-w-0 items-center gap-2">
      <span
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums",
          state === "done" ? "bg-status-success-bg text-status-success-fg" : state === "current" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {state === "done" ? <Check aria-hidden className="size-3.5" strokeWidth={2.5} /> : n}
        <span className="sr-only">{state === "done" ? "done" : state === "current" ? "current step" : "to do"}</span>
      </span>
      <span className="min-w-0">
        <span className={cn("block text-[13px] leading-tight font-medium", state === "todo" && "text-muted-foreground")}>{label}</span>
        {detail ? <span className="block truncate text-[11px] text-muted-foreground">{detail}</span> : null}
      </span>
    </li>
  );
}

export function questionOptions(doc: unknown): RefOption[] {
  const qs = (doc as { openQuestions?: Array<{ id: string; text: string; owner?: string }> } | undefined)?.openQuestions ?? [];
  return qs.map((q) => ({ id: q.id, text: q.text, ...(q.owner ? { hint: ` · ${q.owner}` } : {}) }));
}

export function EpicsPanel({ projectId, bundle, readOnly }: { projectId: string; bundle: ProjectBundle; readOnly?: boolean }) {
  const brd = stageDoc(bundle, "brd");
  const epics = bundle.epics;
  const [sheet, setSheet] = useState<{ open: boolean; epic?: Epic }>({ open: false });
  const accept = useAcceptEpics(projectId);
  const sync = useSyncEpics(projectId);
  const accepted = brd?.status === "accepted";
  const open = epics.filter((e) => !isParked(e));
  const drafts = open.filter((e) => e.status === "draft");
  const parked = epics.filter(isParked);
  const toSync = epics.filter((e) => e.status === "accepted" && !e.key);
  const synced = epics.filter((e) => e.status === "synced");
  const acceptedAt = bundle.project.stages.requirements.epicsAcceptedAt;
  const reviewDone = open.length > 0 && drafts.length === 0;
  const allSynced = open.length > 0 && open.every((e) => e.status === "synced");
  const parents = parentEpicDeps(brd?.dependencies ?? []);
  const requirements: RefOption[] = (brd?.requirements ?? []).map((r) => ({ id: r.id, text: r.text, ...(r.candidate ? { hint: " · candidate" } : {}) }));

  if (!accepted) {
    return (
      <SectionCard density="dense">
        <EmptyState icon={SquareStack} title="Epics come from the accepted BRD" body="Once you accept the BRD, epics are proposed from its numbered requirements. You review them here, accept them and create them in Jira (mock)." />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <MockJiraBanner />
      <SectionCard
        density="dense"
        title="Epics"
        description={[
          `${epics.length} ${epics.length === 1 ? "epic" : "epics"} proposed from the BRD`,
          drafts.length ? `${drafts.length} draft` : "",
          epics.filter((e) => e.status === "accepted").length ? `${epics.filter((e) => e.status === "accepted").length} accepted` : "",
          synced.length ? `${synced.length} in Jira` : "",
          parked.length ? `${parked.length} blocked` : "",
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          !readOnly ? (
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => setSheet({ open: true })}>
              <Plus aria-hidden />
              Add epic
            </Button>
          ) : null
        }
      >
        <div className="space-y-4">
          <ol className="grid gap-3 rounded-xl bg-muted/50 p-3 sm:grid-cols-3" aria-label="Epic steps">
            <FlowStep n={1} label="Review the proposal" state={reviewDone ? "done" : "current"} detail={drafts.length ? `${drafts.length} draft to review` : "Edit, add or delete"} />
            <FlowStep n={2} label="Accept epics" state={reviewDone ? "done" : "todo"} detail={acceptedAt && reviewDone ? "Accepted" : "Accepts every draft"} />
            <FlowStep n={3} label="Create in Jira (mock)" state={allSynced ? "done" : reviewDone ? "current" : "todo"} detail={allSynced ? `${synced.length} created` : toSync.length ? `${toSync.length} ready` : "Assigns keys"} />
          </ol>

          {epics.length === 0 ? (
            <EmptyState
              size="sm"
              icon={SquareStack}
              title="No epics yet"
              body="Every BRD requirement is already covered, or none were proposed. Add at least one epic to pass the gate."
              action={
                !readOnly ? (
                  <Button size="sm" className="rounded-full" onClick={() => setSheet({ open: true })}>
                    <Plus aria-hidden />
                    Add epic
                  </Button>
                ) : null
              }
            />
          ) : (
            <EpicTable projectId={projectId} epics={epics} brTexts={refTexts(brd?.requirements)} readOnly={readOnly} onEdit={(epic) => setSheet({ open: true, epic })} />
          )}

          {parked.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {parked.length === 1 ? "1 epic is" : `${parked.length} epics are`} blocked by an open question and {parked.length === 1 ? "stays" : "stay"} draft when you accept: {parked.map((e) => `${e.title} (${e.blockedBy?.join(", ")})`).join("; ")}. Edit an epic to clear its blocker once the question is answered.
            </p>
          ) : null}

          {!readOnly ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button className="rounded-full" disabled={drafts.length === 0 || accept.isPending} onClick={() => accept.mutate("requirements")}>
                <ListChecks aria-hidden />
                {accept.isPending ? "Accepting…" : drafts.length ? `Accept ${drafts.length} ${drafts.length === 1 ? "epic" : "epics"}` : "Epics accepted"}
              </Button>
              <Button variant={drafts.length === 0 && toSync.length ? "default" : "outline"} className="rounded-full" disabled={toSync.length === 0 || sync.isPending} onClick={() => sync.mutate()}>
                <CloudUpload aria-hidden />
                {sync.isPending ? "Creating…" : toSync.length ? `Create ${toSync.length} in Jira` : allSynced ? "All in Jira" : "Create in Jira"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {drafts.length ? "Accept the epics before creating them in Jira." : toSync.length ? `Keys come from the ${bundle.project.jiraProject} project (mock).` : allSynced ? "Every open epic has a Jira key." : ""}
              </span>
            </div>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard density="dense" title="Existing in Jira" description="Parent epics discovery found. Hang the new epics under one of them.">
        <ExistingEpics projectId={projectId} parents={parents} epics={epics} readOnly={readOnly} />
      </SectionCard>

      <EpicSheet
        projectId={projectId}
        open={sheet.open}
        onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))}
        epic={sheet.epic}
        requirements={requirements}
        questions={questionOptions(brd)}
        parents={parents.map((p) => ({ ref: p.ref, title: p.title }))}
      />
    </div>
  );
}
