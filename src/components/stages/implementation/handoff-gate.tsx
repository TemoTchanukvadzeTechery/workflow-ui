"use client";

/**
 * The Implementation gate, "Hand off to QA →" (brief C.3, D.3 pattern 2). The shared GateFooter
 * cannot carry the Ready-for-test note, so this gate is local: the same sticky footer, blockers
 * with a tooltip, warnings ticked in the dialog, plus an editable Markdown note (prefilled from
 * the approved tasks) sent as readyForTestNote on the decision only when the developer edited it
 * (the server writes the same shared draft otherwise). After approval it links to the stored
 * Ready for test document and on to QA Certification.
 */
import { AlertTriangle, ArrowRight, ArrowUpRight, CheckCircle2, CircleSlash, Eye, FileText, FlaskConical, Pencil, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { RelativeTime, actorText } from "@/components/common";
import { Markdown } from "@/components/docs";
import { Notice } from "@/components/hitl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { stageHref } from "@/hooks/use-stage-params";
import { useStageDecision } from "@/lib/api/queries";
import type { DecisionBody, ProjectBundle } from "@/lib/delivery/types";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { docHref, docOf } from "./inputs";
import { missingSections, readyForTestDraft } from "./ready-for-test";

const LABEL = "Hand off to QA";

export function HandoffGate({ projectId, bundle, className }: { projectId: string; bundle: ProjectBundle; className?: string }) {
  const view = bundle.stages.implementation;
  const record = bundle.project.stages.implementation;
  const [open, setOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const blockers = view.blockers;
  const warnings = view.warnings;
  const lastApproval = [...record.decisions].reverse().find((d) => d.decision === "approved");
  // A gate "Request changes" only records a note. Show it while it is the latest decision and
  // newer than the plan approval; a later decision or plan approval makes it history.
  const latest = record.decisions.at(-1);
  const lastChanges = latest?.decision === "changes_requested" && latest.at > (record.planApprovedAt ?? 0) ? latest : undefined;
  // Nothing to request changes on before there is an approved plan (the plan review has Revise).
  const canRequestChanges = !!record.planApprovedAt;
  const rft = docOf(bundle, "ready-for-test");
  const shell = "sticky bottom-0 z-10 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-[0_-1px_2px_rgba(0,0,0,.04)] backdrop-blur";

  if (view.status === "locked") return null;

  if (view.status === "approved" || bundle.project.done) {
    return (
      <div className={cn(shell, className)} role="region" aria-label="Implementation gate">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <CheckCircle2 aria-hidden className="size-4 text-status-success-fg" />
          <span className="font-medium">Handed off to QA</span>
          {lastApproval ? (
            <span className="text-muted-foreground">
              by {actorText(lastApproval.by)} · <RelativeTime at={lastApproval.at} />
              {lastApproval.comment ? ` · "${lastApproval.comment}"` : ""}
            </span>
          ) : null}
          <span className="flex-1" />
          {rft ? (
            <Link href={docHref(projectId, rft)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <FileText aria-hidden className="size-3.5" />
              Ready for test note
              <ArrowUpRight aria-hidden className="size-3.5" />
            </Link>
          ) : null}
          {bundle.stages.qa.status !== "locked" ? (
            <Button asChild size="sm" className="h-8 rounded-full px-3">
              <Link href={stageHref(projectId, "qa")}>
                <FlaskConical aria-hidden />
                Go to QA Certification
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const primary = (
    <Button className="rounded-full px-4" disabled={blockers.length > 0} onClick={() => setOpen(true)}>
      {LABEL}
      <ArrowRight aria-hidden />
    </Button>
  );

  return (
    <TooltipProvider delayDuration={100}>
      <div className={cn("@container", shell, className)} role="region" aria-label="Implementation gate">
        <div className="flex flex-col gap-3 @xl:flex-row @xl:items-center">
          <div className="min-w-0 flex-1 space-y-0.5 text-[13px]">
            {blockers.length > 0 ? (
              <p className="flex items-start gap-1.5">
                <CircleSlash aria-hidden className="mt-0.5 size-4 shrink-0 text-status-danger-fg" />
                <span className="line-clamp-2 @xl:line-clamp-none">
                  <span className="font-medium">{plural(blockers.length, "blocker")}:</span>{" "}
                  <span className="text-muted-foreground">
                    {blockers.slice(0, 2).join("; ")}
                    {blockers.length > 2 ? `; +${blockers.length - 2} more` : ""}
                  </span>
                </span>
              </p>
            ) : (
              <p className="flex items-center gap-1.5">
                <CheckCircle2 aria-hidden className="size-4 text-status-success-fg" />
                <span className="font-medium">Every task is done.</span>
                <span className="text-muted-foreground">Write the Ready for test note and hand off to QA.</span>
              </p>
            )}
            {warnings.length > 0 ? (
              <p className="flex items-start gap-1.5 text-muted-foreground">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-status-attention-fg" />
                {plural(warnings.length, "warning")} to acknowledge
              </p>
            ) : null}
            {lastChanges ? (
              <p className="text-xs text-muted-foreground">
                Changes requested by {actorText(lastChanges.by)} <RelativeTime at={lastChanges.at} />
                {lastChanges.comment ? `: "${lastChanges.comment}"` : ""}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 @xl:justify-end">
            {canRequestChanges ? (
              <Button variant="outline" className="rounded-full" onClick={() => setChangesOpen(true)}>
                Request changes
              </Button>
            ) : null}
            {blockers.length > 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* Disabled buttons fire no pointer events, so the wrapper carries the tooltip. */}
                  <span tabIndex={0} className="inline-flex rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label={`${LABEL} is blocked: ${blockers.join("; ")}`}>
                    {primary}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-sm flex-col items-start">
                  <span className="font-medium">Resolve before handing off:</span>
                  <ul className="list-disc pl-4">
                    {blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </TooltipContent>
              </Tooltip>
            ) : (
              primary
            )}
          </div>
        </div>
      </div>
      {open ? <HandoffDialog projectId={projectId} bundle={bundle} warnings={warnings} onClose={() => setOpen(false)} /> : null}
      {canRequestChanges ? <RequestChangesDialog projectId={projectId} open={changesOpen} onOpenChange={setChangesOpen} /> : null}
    </TooltipProvider>
  );
}

function HandoffDialog({ projectId, bundle, warnings, onClose }: { projectId: string; bundle: ProjectBundle; warnings: string[]; onClose: () => void }) {
  // The server writes this same draft when the decision carries no note, so the note is sent
  // only when it differs; an unchanged note stays an agent-written version, not a human edit.
  const draft = readyForTestDraft(bundle);
  const [note, setNote] = useState(bundle.project.stages.implementation.readyForTestNote ?? draft);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [comment, setComment] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const decide = useStageDecision(projectId);
  const base = useId();
  const allTicked = warnings.every((w) => ticked.has(w));
  const untickedCount = warnings.filter((w) => !ticked.has(w)).length;
  const missing = missingSections(note);
  const edited = note !== draft;
  const whyDisabled = !note.trim() ? "Write the Ready for test note" : untickedCount > 0 ? `Acknowledge ${plural(untickedCount, "warning")} above` : null;

  const submit = () => {
    const body: DecisionBody & { readyForTestNote?: string } = {
      decision: "approved",
      ...(comment.trim() ? { comment: comment.trim() } : {}),
      ...(warnings.length > 0 ? { acknowledgedWarnings: warnings } : {}),
      ...(edited && note.trim() ? { readyForTestNote: note } : {}),
    };
    decide.mutate({ stage: "implementation", body }, { onSuccess: onClose });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Hand off to QA?</DialogTitle>
          <DialogDescription>This approves Implementation and moves the project to QA Certification. QA starts from the Ready for test note below. Your name and the time are recorded.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {warnings.length > 0 ? (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-medium">Acknowledge each warning before handing off</legend>
              {warnings.map((w, i) => {
                const id = `${base}-w${i}`;
                return (
                  <div key={w} className="flex items-start gap-2 rounded-lg bg-status-attention-bg px-3 py-2">
                    <Checkbox
                      id={id}
                      checked={ticked.has(w)}
                      onCheckedChange={(c) =>
                        setTicked((s) => {
                          const next = new Set(s);
                          if (c === true) next.add(w);
                          else next.delete(w);
                          return next;
                        })
                      }
                      className="mt-0.5"
                    />
                    <label htmlFor={id} className="text-[13px] leading-snug">
                      {w}
                    </label>
                  </div>
                );
              })}
            </fieldset>
          ) : null}

          <Tabs value={tab} onValueChange={(v) => setTab(v as "edit" | "preview")} className="gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium">Ready for test note</span>
              <span className="font-mono text-[11px] text-muted-foreground">.deliver/ready-for-test/{projectId}.md</span>
              <span className="flex-1" />
              <TabsList className="h-8">
                <TabsTrigger value="edit" className="px-2.5 text-xs">
                  <Pencil aria-hidden />
                  Edit
                </TabsTrigger>
                <TabsTrigger value="preview" className="px-2.5 text-xs">
                  <Eye aria-hidden />
                  Preview
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="edit">
              <Textarea
                id={`${base}-note`}
                aria-label="Ready for test note (Markdown)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={16}
                spellCheck={false}
                className="min-h-72 font-mono text-xs leading-relaxed"
              />
            </TabsContent>
            <TabsContent value="preview">
              <div className="relative max-h-[50vh] overflow-y-auto rounded-xl border border-border px-4 py-3">
                <Markdown source={note} size="sm" />
              </div>
            </TabsContent>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Prefilled from the approved tasks: TL;DR, Env, Branch, What to check, Regression (dev-covered), Markets, Localization, Notes, Evidence.</span>
              {edited ? (
                <Button size="sm" variant="ghost" className="h-6 rounded-full px-2 text-xs" onClick={() => setNote(draft)}>
                  <RotateCcw aria-hidden />
                  Reset to the prefilled note
                </Button>
              ) : null}
            </div>
            {missing.length > 0 ? <Notice>Missing sections QA expects: {missing.join(", ")}.</Notice> : null}
          </Tabs>


          <div className="space-y-1.5">
            <label htmlFor={`${base}-comment`} className="text-xs font-medium">
              Comment <span className="font-normal text-muted-foreground">optional</span>
            </label>
            <Textarea id={`${base}-comment`} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        </div>

        <DialogFooter className="items-center">
          {whyDisabled ? (
            <p className="mr-auto text-xs text-muted-foreground" role="status">
              {whyDisabled}
            </p>
          ) : null}
          <Button variant="outline" className="rounded-full" onClick={onClose}>
            Cancel
          </Button>
          <Button className="rounded-full" onClick={submit} disabled={!allTicked || !note.trim() || decide.isPending}>
            {decide.isPending ? "Handing off…" : LABEL}
            <ArrowRight aria-hidden />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestChangesDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [comment, setComment] = useState("");
  const decide = useStageDecision(projectId);
  const id = useId();
  const submit = () => {
    if (!comment.trim()) return;
    decide.mutate(
      { stage: "implementation", body: { decision: "changes_requested", comment: comment.trim() } },
      {
        onSuccess: () => {
          onOpenChange(false);
          setComment("");
        },
      },
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request changes to Implementation</DialogTitle>
          <DialogDescription>
            This records a note on the Implementation gate and keeps the stage open. It does not send tasks back to the agents: to have an agent change a task, use Request changes on that task&apos;s review.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label htmlFor={id} className="text-xs font-medium">
            What needs to change before the hand-off? <span className="font-normal text-muted-foreground">required</span>
          </label>
          <Textarea id={id} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="rounded-full" onClick={submit} disabled={!comment.trim() || decide.isPending}>
            {decide.isPending ? "Sending…" : "Request changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
