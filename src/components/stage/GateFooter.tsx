"use client";

/**
 * The stage gate, sticky under the stage workspace while the stage is open. Blockers (from the
 * server's StageView, linked where they are resolved) disable the approve button and are listed
 * inline behind "Show all", which works on touch; when blockers remain, the next action (the
 * project's next step on this stage) is the primary control. Warnings must each be ticked in the
 * confirm dialog and are stored as acknowledgedWarnings. Request changes records the decision
 * with a required comment; at PO Review it is "Send back", which reopens a chosen earlier stage.
 * Below md the footer collapses to one line ("2 blockers · Start requirements run") that expands.
 * Once the stage is approved it is a plain, non-sticky line with a link on to the next stage.
 */
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, CircleSlash, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useReopenStage, useStageDecision } from "@/lib/api/queries";
import { STAGES, stageDef, type Decision, type StageBlocker, type StageId, type StageView } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { actorName, TimeAgo } from "../hitl/bits";
import { revealTarget } from "./next-action";

export interface GateNextAction {
  /** Button text, e.g. "Start the requirements run". */
  label: string;
  href: string;
  /** The full next-step text, for the tooltip. */
  title?: string;
}

export interface GateFooterProps {
  projectId: string;
  stage: StageId;
  view: StageView;
  /** e.g. "Approve & move to Architecture"; an arrow icon is appended. */
  approveLabel: string;
  nextStage?: StageId;
  /** The stage's decisions (project.stages[stage].decisions), for "Approved by … " and the last request. */
  decisions?: Decision[];
  /** Project is done: the gate is read-only. */
  done?: boolean;
  /** What to do next while blockers remain; it becomes the primary control. */
  nextAction?: GateNextAction;
  /** Offer "Request changes" / "Send back" (off while the stage has not started or produced nothing). */
  canRequestChanges?: boolean;
  /** When the stage last changed; the "Changes requested by …" line shows only while that request is the latest event. */
  lastEventAt?: number;
  className?: string;
}

function stripArrow(label: string): string {
  return label.replace(/\s*(->|→)\s*$/, "");
}

/** "Approve & move to Architecture" → "Approve", for the one-line phone footer. */
function shortLabel(label: string): string {
  return stripArrow(label).split(" & ")[0];
}

/**
 * Same-page links (?step=, ?request=) replace the URL and scroll to their target; others navigate.
 * Forwards the rest of its props so it can sit under <Button asChild>.
 */
function GateLink({ href, label, onClick, children, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string; label?: string; children: ReactNode }) {
  const router = useRouter();
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const url = new URL(href, window.location.href);
    if (url.pathname !== window.location.pathname) return;
    e.preventDefault();
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
    revealTarget(href, label);
  };
  return (
    <Link href={href} onClick={go} {...rest}>
      {children}
    </Link>
  );
}

function BlockerList({ items, id, className }: { items: StageBlocker[]; id?: string; className?: string }) {
  return (
    <ul id={id} className={cn("space-y-1", className)}>
      {items.map((b) => (
        <li key={b.text} className="flex items-start gap-1.5 text-[13px] leading-5">
          <CircleSlash aria-hidden className="mt-0.5 size-3.5 shrink-0 text-status-danger-fg" />
          {b.href ? (
            <GateLink href={b.href} className="min-w-0 text-primary underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              {b.text}
            </GateLink>
          ) : (
            <span className="min-w-0 text-muted-foreground">{b.text}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function GateFooter({ projectId, stage, view, approveLabel, nextStage, decisions = [], done, nextAction, canRequestChanges = true, lastEventAt, className }: GateFooterProps) {
  const def = stageDef(stage);
  const next = nextStage ? stageDef(nextStage) : STAGES.find((s) => s.n === def.n + 1);
  const isSignoff = stage === "signoff";
  const [approveOpen, setApproveOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  // Phones: the one-line footer expands. Wider: the blocker list opens under "Show all".
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const detailsId = useId();
  const listId = useId();
  const items: StageBlocker[] = view.blockerItems && view.blockerItems.length === view.blockers.length ? view.blockerItems : view.blockers.map((text) => ({ text }));
  const warnings = view.warnings;
  const lastApproval = [...decisions].reverse().find((d) => d.decision === "approved");
  const lastChanges = [...decisions].reverse().find((d) => d.decision === "changes_requested");
  // A change request is news until something else happens on the stage (a run, an answer, a revision).
  const showChanges = !!lastChanges && (lastEventAt === undefined || lastEventAt <= lastChanges.at + 2_000);

  if (view.status === "locked") return null;

  if (view.status === "approved" || done) {
    const nextView = next && !isSignoff ? next : undefined;
    return (
      <div className={cn("rounded-2xl border border-border bg-card px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,.04)]", className)} role="region" aria-label={`${def.title} gate`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[13px]">
          <CheckCircle2 aria-hidden className="size-4 text-status-success-fg" />
          <span className="font-medium">{isSignoff ? "Signed off" : `${def.title} approved`}</span>
          {lastApproval ? (
            <span className="min-w-0 text-muted-foreground">
              by {actorName(lastApproval.by)} · <TimeAgo at={lastApproval.at} />
              {lastApproval.comment ? ` · "${lastApproval.comment}"` : ""}
            </span>
          ) : null}
          {nextView ? (
            <Button asChild variant="outline" size="sm" className="ml-auto rounded-full">
              <Link href={`/projects/${encodeURIComponent(projectId)}/${nextView.id}`}>
                Open {nextView.title}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const blocked = items.length > 0;
  const primaryNext = blocked ? nextAction : undefined;
  const title = stripArrow(approveLabel);
  const summary = blocked ? `${items.length} ${items.length === 1 ? "blocker" : "blockers"}` : "Ready for approval";
  const warningText = warnings.length > 0 ? `${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"} to acknowledge` : null;

  const approve = (compact: boolean) => (
    <Button variant={primaryNext ? "outline" : "default"} className={cn("rounded-full", primaryNext ? "" : "px-4")} disabled={blocked} onClick={() => setApproveOpen(true)} title={blocked ? `Resolve first: ${view.blockers.join("; ")}` : undefined}>
      {compact ? <span className="md:hidden">{shortLabel(approveLabel)}</span> : null}
      <span className={compact ? "hidden md:inline" : undefined}>{title}</span>
      {!isSignoff && !primaryNext ? <ArrowRight aria-hidden /> : null}
    </Button>
  );
  const changesButton = canRequestChanges ? (
    <Button variant="outline" className="rounded-full" onClick={() => setChangesOpen(true)}>
      {isSignoff ? <Undo2 aria-hidden /> : null}
      {isSignoff ? "Send back" : "Request changes"}
    </Button>
  ) : null;
  const changesLine =
    showChanges && lastChanges ? (
      <p className="text-xs text-muted-foreground">
        Changes requested by {actorName(lastChanges.by)} <TimeAgo at={lastChanges.at} />
        {lastChanges.comment ? `: "${lastChanges.comment}"` : ""}
      </p>
    ) : null;

  return (
    <>
      <div
        className={cn("sticky bottom-0 z-10 rounded-2xl border border-border bg-card/95 px-3 py-2 shadow-[0_-1px_2px_rgba(0,0,0,.04)] backdrop-blur md:px-4 md:py-3", className)}
        role="region"
        aria-label={`${def.title} gate`}
      >
        <div className="flex items-center gap-2 md:items-start md:gap-3">
          {/* Phones: the summary keeps its words and the action button truncates; wider, the other way round. */}
          <div className="shrink-0 text-[13px] md:min-w-0 md:flex-1 md:shrink">
            {/* Phones: one tappable line that opens the details below. */}
            <button
              type="button"
              className="flex max-w-full min-w-0 items-center gap-1.5 rounded-md py-1 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:hidden"
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={() => setExpanded((o) => !o)}
            >
              {blocked ? <CircleSlash aria-hidden className="size-4 shrink-0 text-status-danger-fg" /> : <CheckCircle2 aria-hidden className="size-4 shrink-0 text-status-success-fg" />}
              <span className="font-medium whitespace-nowrap">{blocked || warnings.length === 0 ? summary : `Ready · ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}`}</span>
              {expanded ? <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : <ChevronUp aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
              <span className="sr-only">{expanded ? "Hide details" : "Show details"}</span>
            </button>
            {/* Wider: the summary with the first blocker, and the full list on demand. */}
            <div className="hidden space-y-1 md:block">
              {blocked ? (
                <div className="flex items-start gap-1.5">
                  <CircleSlash aria-hidden className="mt-0.5 size-4 shrink-0 text-status-danger-fg" />
                  <p className="min-w-0">
                    <span className="font-medium">{summary}</span>
                    {!showAll ? (
                      <>
                        <span className="font-medium">: </span>
                        {items[0].href ? (
                          <GateLink href={items[0].href} className="text-primary underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                            {items[0].text}
                          </GateLink>
                        ) : (
                          <span className="text-muted-foreground">{items[0].text}</span>
                        )}
                      </>
                    ) : null}
                    {items.length > 1 ? (
                      <button
                        type="button"
                        className="ml-2 inline-flex items-center gap-0.5 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        aria-expanded={showAll}
                        aria-controls={listId}
                        onClick={() => setShowAll((s) => !s)}
                      >
                        {showAll ? "Show less" : `Show all ${items.length}`}
                        {showAll ? <ChevronUp aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
                      </button>
                    ) : null}
                  </p>
                </div>
              ) : (
                <p className="flex items-center gap-1.5">
                  <CheckCircle2 aria-hidden className="size-4 text-status-success-fg" />
                  <span className="font-medium">{summary}</span>
                </p>
              )}
              {showAll && blocked ? <BlockerList id={listId} items={items} className="pl-5.5" /> : null}
              {warningText ? (
                <p className="flex items-start gap-1.5 text-muted-foreground">
                  <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-status-attention-fg" />
                  {warningText}
                </p>
              ) : null}
              {changesLine}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 md:flex-none md:shrink-0">
            {changesButton ? <span className="hidden md:contents">{changesButton}</span> : null}
            {primaryNext ? <span className="hidden md:contents">{approve(false)}</span> : approve(true)}
            {primaryNext ? (
              <Button asChild className="max-w-full min-w-0 rounded-full px-4 md:max-w-[min(26rem,40vw)]">
                <GateLink href={primaryNext.href} label={primaryNext.label} title={primaryNext.title ?? primaryNext.label}>
                  <span className="truncate">{primaryNext.label}</span>
                  <ArrowRight aria-hidden />
                </GateLink>
              </Button>
            ) : null}
          </div>
        </div>
        {/* Phones: the expanded details. */}
        <div id={detailsId} className={cn("mt-2 space-y-2 border-t border-border pt-2 md:hidden", expanded ? "block" : "hidden")}>
          {blocked ? <BlockerList items={items} /> : null}
          {warningText ? (
            <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-status-attention-fg" />
              {warningText}
            </p>
          ) : null}
          {changesLine}
          {changesButton || primaryNext ? (
            <div className="flex flex-wrap items-center gap-2">
              {changesButton}
              {primaryNext ? approve(false) : null}
            </div>
          ) : null}
        </div>
      </div>
      <ApproveDialog open={approveOpen} onOpenChange={setApproveOpen} projectId={projectId} stage={stage} warnings={warnings} title={title} nextTitle={next?.title} isSignoff={isSignoff} />
      {isSignoff ? (
        <SendBackDialog open={changesOpen} onOpenChange={setChangesOpen} projectId={projectId} />
      ) : (
        <RequestChangesDialog open={changesOpen} onOpenChange={setChangesOpen} projectId={projectId} stage={stage} />
      )}
    </>
  );
}

function ApproveDialog({
  open,
  onOpenChange,
  projectId,
  stage,
  warnings,
  title,
  nextTitle,
  isSignoff,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  stage: StageId;
  warnings: string[];
  title: string;
  nextTitle?: string;
  isSignoff: boolean;
}) {
  const [comment, setComment] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const decide = useStageDecision(projectId);
  const commentId = useId();
  const allTicked = warnings.every((w) => ticked.has(w));
  const submit = () => {
    decide.mutate(
      { stage, body: { decision: "approved", ...(comment.trim() ? { comment: comment.trim() } : {}), ...(warnings.length > 0 ? { acknowledgedWarnings: warnings } : {}) } },
      {
        onSuccess: () => {
          onOpenChange(false);
          setComment("");
          setTicked(new Set());
        },
      },
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}?</DialogTitle>
          <DialogDescription>
            {isSignoff
              ? "Signing off marks the project done and makes it read-only. Your name and the time are recorded."
              : `This approves ${stageDef(stage).title}${nextTitle ? ` and moves the project to ${nextTitle}` : ""}. Your name and the time are recorded.`}
          </DialogDescription>
        </DialogHeader>
        {warnings.length > 0 ? (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium">Acknowledge each warning</legend>
            {warnings.map((w, i) => {
              const id = `${commentId}-w${i}`;
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
        <div className="space-y-1.5">
          <label htmlFor={commentId} className="text-xs font-medium">
            Comment <span className="font-normal text-muted-foreground">optional</span>
          </label>
          <Textarea id={commentId} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="rounded-full" onClick={submit} disabled={!allTicked || decide.isPending}>
            {decide.isPending ? "Approving…" : isSignoff ? "Sign off" : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Where the actual rework happens, since a gate change request only records the decision. */
const REWORK_ROUTE: Partial<Record<StageId, string>> = {
  requirements: "To have po-brd rework the BRD, choose Revise in the BRD review, or Start another run.",
  architecture: "To have architect-aad rework the AAD, choose Revise in the AAD review, or Start another run.",
  implementation: "To send a task back to its agent, request changes in that task's review.",
  qa: "To send a task back to implementation, choose Bugs found in its QA review.",
};

function RequestChangesDialog({ open, onOpenChange, projectId, stage }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string; stage: StageId }) {
  const [comment, setComment] = useState("");
  const decide = useStageDecision(projectId);
  const id = useId();
  const def = stageDef(stage);
  const submit = () => {
    if (!comment.trim()) return;
    decide.mutate(
      { stage, body: { decision: "changes_requested", comment: comment.trim() } },
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
          <DialogTitle>Request changes to {def.title}</DialogTitle>
          <DialogDescription>
            This records a change request for the team: your comment and name are stored and {def.title} stays open. It does not start any agent work. {REWORK_ROUTE[stage] ?? ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label htmlFor={id} className="text-xs font-medium">
            What needs to change? <span className="font-normal text-muted-foreground">required</span>
          </label>
          <Textarea id={id} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="rounded-full" onClick={submit} disabled={!comment.trim() || decide.isPending}>
            {decide.isPending ? "Recording…" : "Record change request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendBackDialog({ open, onOpenChange, projectId }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string }) {
  const targets = STAGES.filter((s) => s.id !== "signoff");
  const [target, setTarget] = useState<StageId>("qa");
  const [comment, setComment] = useState("");
  const reopen = useReopenStage(projectId);
  const router = useRouter();
  const id = useId();
  const selectId = useId();
  const later = STAGES.filter((s) => s.n > stageDef(target).n);
  const submit = () => {
    if (!comment.trim()) return;
    reopen.mutate(
      { stage: target, body: { comment: comment.trim() } },
      {
        onSuccess: () => {
          onOpenChange(false);
          setComment("");
          // PO Review is locked once an earlier stage reopens; follow the work to the reopened stage.
          router.push(`/projects/${encodeURIComponent(projectId)}/${target}`);
        },
      },
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send back</DialogTitle>
          <DialogDescription>Reopen an earlier stage. Stages after it keep their data but are marked stale until they are approved again.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label htmlFor={selectId} className="text-xs font-medium">
            Send back to
          </label>
          <Select value={target} onValueChange={(v) => setTarget(v as StageId)}>
            <SelectTrigger id={selectId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {targets.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  Stage {s.n} · {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Marked stale and locked until re-approved: {later.map((s) => s.title).join(", ")}.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={id} className="text-xs font-medium">
            Why? <span className="font-normal text-muted-foreground">required</span>
          </label>
          <Textarea id={id} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. The export misses ambassadors who never logged in." />
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="rounded-full" onClick={submit} disabled={!comment.trim() || reopen.isPending}>
            {reopen.isPending ? "Sending back…" : `Send back to ${stageDef(target).title}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
