"use client";

/**
 * task:review:<cycle> (dev-task, kind "review", phase "Review"). Subject: the task's diff
 * ("changes", text/x-diff); attachments "verification report" and "agent summary". Approve marks
 * the task done; Request changes (feedback required) runs a rework cycle. After maxReworkCycles
 * the question starts with "Escalated: " and the schema adds "cancel".
 *
 * The form shows the changed files, not the whole diff: on the task page ("Open in Changes"
 * switches to its Changes tab, via TaskReviewHost) the diff is not repeated; elsewhere it opens
 * inline. The acceptance criteria the developer approves against sit next to the feedback, and
 * the decision with its submit button stays pinned to the bottom of the screen while the form is
 * in view (not in compact placements).
 */
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleCheck, CircleX, FileDiff, FileMinus2, FilePen, FilePlus2, RotateCcw, ShieldCheck, Ban, ArrowUpRight } from "lucide-react";
import { createContext, useContext, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useBlobText } from "@/lib/api/queries";
import { enumValues } from "@/lib/weft/schema-form";
import type { CheckState, RunDetail } from "@/lib/weft/types";
import type { DevTaskInput, TaskReviewAnswer } from "@/lib/weft/workflows";
import { cn } from "@/lib/utils";
import { Markdown } from "../../docs/Markdown";
import { TextDiff, parseDiffText } from "../../docs/TextDiff";
import { FloatingChip } from "@/components/common";
import { Notice, TonePill } from "../bits";
import { BlobContent } from "../BlobContent";
import { FormRow, PillChoice } from "../controls";
import { keyNumber, parseTaskQuestion } from "../parse";
import { RequestFooter } from "../RequestFooter";
import { artifactSubject, findAttachment, type RequestFormProps } from "../types";
import { useAnswerRequest } from "../use-answer-request";

type Decision = TaskReviewAnswer["decision"];

/**
 * A page that shows the task's diff itself (the task page's Changes tab) provides this, so the
 * form links there instead of rendering the same diff a second time.
 */
export interface TaskReviewHost {
  openChanges: (runId: string) => void;
}
export const TaskReviewHostContext = createContext<TaskReviewHost | null>(null);

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-[16px] bg-well/60 px-4 py-3">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-[20px] leading-7 tracking-[-0.02em] text-heading tabular-nums", tone === "good" && "text-status-success-fg", tone === "bad" && "text-status-danger-fg")}>{value}</div>
    </div>
  );
}

const FILE_ICON = { added: FilePlus2, deleted: FileMinus2, modified: FilePen } as const;

/** The subject diff as a file list, with the full diff one click away. */
function ChangedFiles({ diff, runId }: { diff: string; runId: string }) {
  const host = useContext(TaskReviewHostContext);
  const [open, setOpen] = useState(false);
  const files = useMemo(
    () =>
      parseDiffText(diff)
        .filter((f) => f.path)
        .map((f) => {
          const meta = f.rows.filter((r) => r.type === "meta").map((r) => r.text);
          const status = meta.some((m) => m.startsWith("new file mode")) ? "added" : meta.some((m) => m.startsWith("deleted file mode")) ? "deleted" : "modified";
          return { path: f.path!, adds: f.adds, dels: f.dels, status } as const;
        }),
    [diff],
  );
  if (files.length === 0) return <p className="text-[13px] text-muted-foreground">No file changes in this review.</p>;
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-rule border-y border-rule">
        {files.map((f) => {
          const Icon = FILE_ICON[f.status];
          return (
            <li key={f.path} className="flex min-h-11 min-w-0 items-center gap-2.5 px-1 py-2 text-sm">
              <Icon aria-hidden className={cn("size-3.5 shrink-0", f.status === "added" ? "text-status-success-fg" : f.status === "deleted" ? "text-status-danger-fg" : "text-muted-foreground")} />
              <span className="sr-only">{f.status}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-heading" title={f.path}>
                {f.path}
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums">
                <span className="text-status-success-fg">+{f.adds}</span> <span className="text-status-danger-fg">−{f.dels}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {host ? (
        <Button type="button" size="sm" variant="secondary" onClick={() => host.openChanges(runId)}>
          <FileDiff aria-hidden />
          Open the diff in Changes
          <ArrowUpRight aria-hidden />
        </Button>
      ) : (
        <>
          <Button type="button" size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            {open ? "Hide the diff" : "Show the full diff"}
          </Button>
          {open ? <TextDiff diffText={diff} maxHeightClass="max-h-[60vh]" /> : null}
        </>
      )}
    </div>
  );
}

/** Check output lines that name the criterion ("✓ AC-1: …"), from the latest run of each check. */
function coverage(checks: readonly CheckState[], acId: string): Array<{ check: string; pass: boolean }> {
  const re = new RegExp(`\\b${acId.replace("-", "\\-")}\\b`);
  const latest = new Map<string, CheckState>();
  for (const c of checks) latest.set(c.name, c);
  const out: Array<{ check: string; pass: boolean }> = [];
  for (const c of latest.values()) {
    const lines = (c.details ?? []).flatMap((d) => (d.kind === "command" && d.output ? d.output.split("\n") : [])).filter((l) => re.test(l));
    if (lines.length) out.push({ check: c.name, pass: !lines.some((l) => /(✗|✕|FAILED|FAIL\b)/.test(l)) });
  }
  return out;
}

function CriteriaChecklist({ run, className }: { run?: RunDetail; className?: string }) {
  const acs = (run?.input as DevTaskInput | undefined)?.task?.acceptanceCriteria ?? [];
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const base = useId();
  if (acs.length === 0) return null;
  return (
    <fieldset className={cn("min-w-0 space-y-2", className)}>
      <legend className="mb-2 flex w-full items-baseline gap-2 text-sm font-medium text-heading">
        Acceptance criteria
        <span className="font-normal text-muted-foreground tabular-nums">
          {ticked.size}/{acs.length} checked by you
        </span>
      </legend>
      <ul className="space-y-1.5">
        {acs.map((ac) => {
          const id = `${base}-${ac.id}`;
          const cov = coverage(run?.checks ?? [], ac.id);
          return (
            <li key={ac.id} className="flex items-start gap-2.5 rounded-[14px] bg-well/60 px-3.5 py-2.5">
              <Checkbox
                id={id}
                checked={ticked.has(ac.id)}
                onCheckedChange={(c) =>
                  setTicked((s) => {
                    const next = new Set(s);
                    if (c === true) next.add(ac.id);
                    else next.delete(ac.id);
                    return next;
                  })
                }
                className="mt-0.5"
              />
              <label htmlFor={id} className="min-w-0 flex-1 space-y-1 text-sm leading-5">
                <span className="block">
                  <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">{ac.id}</span>
                  {ac.text}
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {cov.length ? (
                    cov.map((c) => (
                      <span key={c.check} className={cn("inline-flex items-center gap-1 font-mono", c.pass ? "text-status-success-fg" : "text-status-danger-fg")}>
                        {c.pass ? <CircleCheck aria-hidden className="size-3" /> : <CircleX aria-hidden className="size-3" />}
                        check:{c.check}
                        <span className="sr-only">{c.pass ? "passed" : "failed"}</span>
                      </span>
                    ))
                  ) : (
                    <span>No dev check names it; QA covers it in Stage 4.</span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

export function TaskReviewForm({ request, run, projectId, compact, onAnswered }: RequestFormProps) {
  const facts = parseTaskQuestion(request.question);
  const escalated = enumValues(request.schema, "decision").includes("cancel") || facts.escalated;
  const cycle = keyNumber(request.key) ?? 1;
  const maxRework = (run?.input as { maxReworkCycles?: unknown } | undefined)?.maxReworkCycles;
  const changes = artifactSubject(request);
  const diffText = useBlobText(changes?.ref.$blob);
  const verification = findAttachment(request, "verification report");
  const summary = findAttachment(request, "agent summary");
  const [decision, setDecision] = useState<Decision | "">("");
  const [feedback, setFeedback] = useState("");
  const decisionId = useId();
  const feedbackId = useId();
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const { submit, pending, error, clearError } = useAnswerRequest({ runId: request.runId, requestId: request.id, projectId, onAnswered });

  const needsFeedback = decision === "request-changes";
  const answer: TaskReviewAnswer | Record<string, never> = decision ? { decision, ...(feedback.trim() ? { feedback: feedback.trim() } : {}) } : {};
  const missing = [...(decision ? [] : ["Choose a decision"]), ...(needsFeedback && !feedback.trim() ? ["Feedback is required to request changes"] : [])];
  const checksFailed = facts.checks !== undefined && facts.passed !== undefined && facts.passed < facts.checks;

  const options = escalated
    ? [
        { value: "approve" as const, label: "Approve anyway", icon: CheckCircle2 },
        { value: "request-changes" as const, label: "One more rework", icon: RotateCcw },
        { value: "cancel" as const, label: "Cancel task", icon: Ban },
      ]
    : [
        { value: "approve" as const, label: "Approve task", icon: CheckCircle2 },
        { value: "request-changes" as const, label: "Request changes", icon: RotateCcw },
      ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {facts.taskKey ? <span className="font-mono text-xs text-heading">{facts.taskKey}</span> : null}
        <FloatingChip label="Review" value={`${cycle}${typeof maxRework === "number" ? ` · ${Math.max(0, cycle - 1)}/${maxRework} reworks used` : ""}`} tone="running" />
        {escalated ? (
          <TonePill tone="danger" icon={AlertTriangle}>
            Escalated
          </TonePill>
        ) : null}
      </div>

      {facts.checks !== undefined ? (
        <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
          <Stat label="Checks" value={`${facts.passed}/${facts.checks} passed`} tone={checksFailed ? "bad" : "good"} />
          <Stat label="Added" value={`+${facts.adds}`} />
          <Stat label="Removed" value={`-${facts.dels}`} />
          <Stat label="Files" value={String(facts.files)} />
        </div>
      ) : null}

      {escalated ? (
        <Notice tone="danger" icon={AlertTriangle}>
          The rework limit is reached. Approve it anyway (the gate will list it as escalated), allow one more rework, or cancel the task (it is then excluded from the gate).
        </Notice>
      ) : null}

      <Tabs defaultValue="changes" className="min-w-0 gap-3">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="justify-start">
            <TabsTrigger value="changes" className="h-9 flex-none px-3.5">
              <FileDiff aria-hidden />
              Changed files
            </TabsTrigger>
            {verification ? (
              <TabsTrigger value="verification" className="h-9 flex-none px-3.5">
                <ShieldCheck aria-hidden />
                Verification report
              </TabsTrigger>
            ) : null}
            {summary ? (
              <TabsTrigger value="summary" className="h-9 flex-none px-3.5">
                Agent summary
              </TabsTrigger>
            ) : null}
          </TabsList>
        </div>
        <TabsContent value="changes" className="min-w-0">
          {changes ? (
            diffText.data !== undefined ? (
              <ChangedFiles diff={diffText.data} runId={request.runId} />
            ) : diffText.error ? (
              <Notice tone="danger">Could not load the diff: {diffText.error.message}</Notice>
            ) : (
              <p className="text-[13px] text-muted-foreground">Loading the changes…</p>
            )
          ) : (
            <p className="text-[13px] text-muted-foreground">No diff attached.</p>
          )}
        </TabsContent>
        {verification ? (
          <TabsContent value="verification" className="min-w-0">
            <BlobContent blobRef={verification.ref}>{(t) => <Markdown source={t} size="sm" />}</BlobContent>
          </TabsContent>
        ) : null}
        {summary ? (
          <TabsContent value="summary" className="min-w-0">
            <BlobContent blobRef={summary.ref}>{(t) => <Markdown source={t} size="sm" />}</BlobContent>
          </TabsContent>
        ) : null}
      </Tabs>

      <div className={cn("grid gap-4", !compact && "@3xl:grid-cols-2")}>
        <CriteriaChecklist run={run} />
        <FormRow label="Feedback" htmlFor={feedbackId} required={needsFeedback} hint={decision === "cancel" ? "Why the task is cancelled (optional)" : "What the agent should change"}>
          <Textarea
            ref={feedbackRef}
            id={feedbackId}
            rows={compact ? 3 : 4}
            value={feedback}
            onChange={(e) => {
              clearError();
              setFeedback(e.target.value);
            }}
            disabled={pending}
            aria-invalid={needsFeedback && !feedback.trim() ? true : undefined}
            placeholder="e.g. Return 400 for an unknown agreement version instead of an empty list."
          />
        </FormRow>
      </div>

      {/* The decision bar: pinned to the bottom of the viewport while the form is on screen; opaque, lifted by a soft top shadow. */}
      <div
        className={cn(
          "space-y-3 border-t border-rule pt-4",
          !compact &&
            "sticky bottom-0 z-10 -mx-5 -mb-5 rounded-b-2xl bg-card px-5 pb-5 shadow-[0_-14px_28px_-20px_rgb(0_0_0/0.18)] @2xl:-mx-6 @2xl:-mb-6 @2xl:px-6 @2xl:pb-6 @3xl:flex @3xl:items-end @3xl:gap-6 @3xl:space-y-0 dark:shadow-[0_-14px_28px_-18px_rgb(0_0_0/0.7)]",
        )}
      >
        <FormRow label="Decision" id={decisionId} required className="min-w-0 @3xl:max-w-[60%]">
          <PillChoice
            value={decision}
            onChange={(v) => {
              clearError();
              setDecision(v);
              // Request changes needs feedback: bring the box into view and focus it.
              if (v === "request-changes" && !feedback.trim()) window.requestAnimationFrame(() => feedbackRef.current?.focus());
            }}
            ariaLabelledBy={decisionId}
            disabled={pending}
            options={options}
          />
          {decision === "approve" && checksFailed ? <Notice className="mt-2">Some checks failed. The Implementation gate will ask you to acknowledge tasks approved with failing checks.</Notice> : null}
        </FormRow>
        <RequestFooter className="min-w-0 border-t-0 pt-0 @3xl:flex-1" requestId={request.id} answer={answer} error={error} pending={pending} missing={missing} onSubmit={() => decision && submit(answer)} />
      </div>
    </div>
  );
}
