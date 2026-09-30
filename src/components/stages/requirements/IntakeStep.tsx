"use client";

/**
 * Stage 1 · Intake. Before any run: the editable intake (request, requirement channels, advanced
 * options) with Save draft, Start requirements run and Import existing BRD. Once a run exists (or
 * a BRD was imported): a read-only summary of what the run started from and the run history,
 * plus "Start another run" when the last run ended without an accepted BRD (pre-filled with the
 * last review feedback as a note), or when the stage was reopened (pre-filled with the reopen
 * comment and the current BRD as notes), next to "Import new version".
 */
import { Import, Play, RotateCcw, Save, X } from "lucide-react";
import { useState } from "react";
import { actorText, SectionCard } from "@/components/common";
import { canStartAnother, lastReviewFeedback, NotAcceptedBanner, OptionsStrip, RequestText, ReviseNotice, revisionCause, RunHistory, runOutput, SourceChips, docRuns, stageDoc, type RevisionCause } from "@/components/doc-stage";
import { Notice, TimeAgo } from "@/components/hitl";
import { ImportDocDialog, IntakeForm, makeSource, validateIntake, type IntakeErrors, type IntakeFormValue } from "@/components/projects";
import { Button } from "@/components/ui/button";
import { useActorName } from "@/lib/api/actor";
import { useStartRequirements, useUpdateIntake } from "@/lib/api/queries";
import type { Intake, ProjectBundle, RequirementSource } from "@/lib/delivery/types";
import type { RunDetail } from "@/lib/weft/types";

export interface IntakeStepProps {
  projectId: string;
  bundle: ProjectBundle;
  run?: RunDetail;
  /** "Start another run" was chosen (here or from the Drafts banner). */
  restart: boolean;
  onRestart: (on: boolean) => void;
  onStarted: () => void;
  onImported: () => void;
  readOnly?: boolean;
}

/**
 * The intake to pre-fill "Start another run" with: the saved intake plus, as notes, the last
 * review feedback, or (reopened stage) the reopen comment and the current BRD file to revise.
 */
function restartIntake(intake: Intake, run: RunDetail | undefined, actor: string, revision?: { cause: RevisionCause; brdPath?: string }): Intake {
  const extra: RequirementSource[] = [];
  const fb = lastReviewFeedback(run);
  if (revision) {
    const { cause, brdPath } = revision;
    extra.push(makeSource("note-text", `Requirements was reopened${cause.by ? ` by ${actorText(cause.by)}` : ""}: ${cause.comment}. Revise the current BRD accordingly.`, actor, "Reopen comment"));
    if (brdPath) extra.push(makeSource("note-file", brdPath, actor, brdPath));
  } else if (fb && run) {
    extra.push(makeSource("note-text", `Feedback from the last review of run ${run.runId} (round ${fb.round}): ${fb.feedback}`, actor, `Last review feedback (${run.runId}, round ${fb.round})`));
  }
  const fresh = extra.filter((x) => !intake.sources.some((s) => s.value === x.value));
  return fresh.length ? { ...intake, sources: [...intake.sources, ...fresh] } : intake;
}

function IntakeEditor({ projectId, bundle, run, restart, onRestart, onStarted, onImported }: IntakeStepProps) {
  const project = bundle.project;
  const [actor] = useActorName();
  const cause = revisionCause(project.stages.requirements);
  const brd = stageDoc(bundle, "brd");
  const [value, setValue] = useState<IntakeFormValue>(() => ({
    name: project.name,
    summary: project.summary,
    intake: restart ? restartIntake(project.intake, run, actor, cause && brd ? { cause, brdPath: brd.path } : undefined) : project.intake,
  }));
  const [errors, setErrors] = useState<IntakeErrors>({});
  const update = useUpdateIntake(projectId);
  const start = useStartRequirements(projectId);
  const dirty = JSON.stringify(value.intake) !== JSON.stringify(project.intake);
  const busy = update.isPending || start.isPending;
  const intakePatch = () => ({ request: value.intake.request, sources: value.intake.sources, options: value.intake.options });

  const save = () => {
    const errs = validateIntake(value, { requireName: false });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    update.mutate(intakePatch());
  };

  const run_ = async () => {
    const errs = validateIntake(value, { forRun: true, requireName: false });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      if (dirty) await update.mutateAsync(intakePatch());
      await start.mutateAsync();
      onRestart(false);
      onStarted();
    } catch (e) {
      // The mutation toasts the message; keep the server's validation text next to the form too.
      setErrors({ form: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <SectionCard
      density="dense"
      title={restart ? "Start another requirements run" : "Intake"}
      description={
        restart
          ? cause && brd
            ? "The saved intake, with the reopen comment and the current BRD added as notes. Change anything, then start the run."
            : "The intake as the last run used it, with the last review feedback added as a note. Change anything, then start the run."
          : "What the po-brd run starts from. The agent reads the request and notes, searches Jira and Confluence from the seeds, then drafts the BRD for your review."
      }
      actions={
        restart ? (
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => onRestart(false)}>
            <X aria-hidden />
            Cancel
          </Button>
        ) : null
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void run_();
        }}
      >
        <IntakeForm value={value} onChange={setValue} errors={errors} mode="edit" projectId={projectId} outPath={project.docPaths.brd} hideIdentity disabled={busy} />
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button type="submit" className="rounded-full" disabled={busy}>
            <Play aria-hidden />
            {start.isPending ? "Starting…" : "Start requirements run"}
          </Button>
          <Button type="button" variant="outline" className="rounded-full" onClick={save} disabled={busy || !dirty}>
            <Save aria-hidden />
            {update.isPending && !start.isPending ? "Saving…" : dirty ? "Save draft" : "Saved"}
          </Button>
          <span className="flex-1" />
          {!restart ? (
            <ImportDocDialog
              projectId={projectId}
              stage="requirements"
              onImported={onImported}
              trigger={
                <Button type="button" variant="ghost" className="rounded-full">
                  <Import aria-hidden />
                  Import existing BRD
                </Button>
              }
            />
          ) : null}
        </div>
      </form>
    </SectionCard>
  );
}

export function IntakeStep(props: IntakeStepProps) {
  const { projectId, bundle, run, restart, onRestart, onImported, readOnly } = props;
  const project = bundle.project;
  const record = project.stages.requirements;
  const runs = docRuns(bundle.stages.requirements, "brd");
  const started = runs.length > 0 || !!record.imported;

  if (!readOnly && (!started || restart)) return <IntakeEditor key={restart ? "restart" : "first"} {...props} />;

  const brd = stageDoc(bundle, "brd");
  const lastStatus = runs.at(-1)?.status;
  const cause = !readOnly && brd ? revisionCause(record) : undefined;
  const again = !readOnly && canStartAnother(run, { revising: !!cause, lastStatus });
  const notAccepted = runOutput(run)?.accepted === false;
  const failed = run?.status === "failed" || run?.status === "cancelled";
  // Imported after the last run (or with no run at all): the import is what the BRD is now.
  const importedLast = !!record.imported && (runs.length === 0 || record.imported.at > (runs.at(-1)?.createdAt ?? 0));
  return (
    <div className="space-y-4">
      {notAccepted ? (
        <NotAcceptedBanner
          kind="brd"
          run={run}
          action={
            again ? (
              <Button size="sm" className="rounded-full" onClick={() => onRestart(true)}>
                <RotateCcw aria-hidden />
                Start another run
              </Button>
            ) : null
          }
        />
      ) : again && failed ? (
        <Notice tone="danger" role="status">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="min-w-0 flex-1">
              <span className="font-medium">The last po-brd run {run?.status === "cancelled" ? "was cancelled" : "failed"}.</span>{" "}
              {run?.error?.message ? <span className="break-words">{run.error.message}</span> : brd?.status === "accepted" ? "The accepted BRD is unchanged." : "No BRD was accepted."}
            </p>
            <Button size="sm" className="rounded-full" onClick={() => onRestart(true)}>
              <RotateCcw aria-hidden />
              Start another run
            </Button>
          </div>
        </Notice>
      ) : null}
      {cause && again ? (
        <ReviseNotice projectId={projectId} kind="brd" cause={cause} doc={brd} onStartAnother={() => onRestart(true)} onImported={onImported} hideStart={notAccepted || failed} />
      ) : null}

      <SectionCard
        density="dense"
        title="Intake"
        description={
          importedLast
            ? "The BRD was imported, so no po-brd run drafted it. This is the intake saved with the project, for a later run."
            : "What the po-brd run started from. Change the request or add notes in Drafts, when the agent asks you to review."
        }
      >
        <div className="space-y-4">
          {record.imported ? (
            <Notice tone="neutral" icon={Import}>
              The BRD was imported {record.imported.source === "confluence" ? `from Confluence page ${record.imported.ref}` : "as pasted markdown"} by {actorText(record.imported.by)} <TimeAgo at={record.imported.at} />
              {importedLast ? ", so no po-brd run was needed." : ", before the po-brd run below."}
            </Notice>
          ) : null}
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">Request</h4>
            <RequestText text={project.intake.request} empty={importedLast ? "No request text; the BRD was imported." : undefined} />
          </div>
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">Requirement channels</h4>
            <SourceChips sources={project.intake.sources} />
          </div>
          <OptionsStrip options={project.intake.options} out={project.docPaths.brd} />
          <RunHistory runs={runs} workflowLabel="po-brd" />
        </div>
      </SectionCard>
      {readOnly && !started ? <p className="text-[13px] text-muted-foreground">No run was started for {projectId}.</p> : null}
    </div>
  );
}
