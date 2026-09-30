"use client";

/**
 * The pending plan:review:<round> request, answered in the stage workspace instead of the rail:
 * the question verbatim, the PlanEditor over the proposed tasks (the "tasks" attachment), the plan
 * report tabs (the "plan report" attachment) and the decision: Approve plan & start agents with a
 * Start mode, or Revise with notes. The answer is a PlanReviewAnswer posted to the dev-plan run;
 * an edited task list goes along as `tasks` and replaces the proposal.
 */
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, FileText, Hourglass, Pencil, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { SectionCard } from "@/components/common";
import { DraftReportTabs, Markdown } from "@/components/docs";
import { BlobContent, FormRow, Notice, PillChoice, START_MODE_LABELS, TimeAgo, findAttachment, fileSubject, keyNumber, parsePlanQuestion, requestDomId, useAnswerRequest } from "@/components/hitl";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useBlobText } from "@/lib/api/queries";
import type { Epic, ProjectBundle } from "@/lib/delivery/types";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HumanState } from "@/lib/weft/types";
import type { PlannedTask, PlanReviewAnswer } from "@/lib/weft/workflows";
import { isRepoName, systemRows } from "./inputs";
import { LeaveGuard } from "./leave-guard";
import { PlanEditor } from "./plan-editor";
import { cleanPlan, planIssues, samePlan, wavesOf } from "./plan-model";

type StartMode = NonNullable<PlanReviewAnswer["start"]>;

function parseTasks(text: string | undefined): PlannedTask[] | null {
  if (!text) return null;
  try {
    const data = JSON.parse(text) as unknown;
    return Array.isArray(data) ? (data as PlannedTask[]) : null;
  } catch {
    return null;
  }
}

export function PlanReview({ projectId, bundle, runId, request, focused }: { projectId: string; bundle: ProjectBundle; runId: string; request: HumanState; focused?: boolean }) {
  const tasksRef = findAttachment(request, "tasks")?.ref.$blob;
  const tasksText = useBlobText(tasksRef);
  const proposal = useMemo(() => parseTasks(tasksText.data), [tasksText.data]);
  const facts = parsePlanQuestion(request.question);
  const round = keyNumber(request.key) ?? facts.round ?? 1;

  return (
    <section id={requestDomId(runId, request.id)} aria-label={`Plan review, round ${round}`} className={cn("scroll-mt-20 space-y-4 rounded-3xl", focused && "ring-2 ring-status-attention-fg/40 ring-offset-4 ring-offset-background")}>
      <div className="card-surface overflow-hidden rounded-2xl">
        <div className="glass m-1.5 flex flex-wrap items-center gap-2 rounded-[22px] px-4 py-2.5">
          <span className="text-[13px] font-medium text-heading">Your review</span>
          <span className="font-mono text-xs text-muted-foreground">plan:review:{round}</span>
          <span className="font-mono text-xs text-muted-foreground">
            dev-plan ·{" "}
            <Link href={`/runs/${runId}`} className="text-primary hover:underline">
              {runId}
            </Link>{" "}
            · {request.id}
          </span>
          <span className="flex-1" />
          <span className="chip-float h-7! gap-1! px-2.5! text-xs! [--chip-glow:var(--status-attention-solid)]">
            <Hourglass aria-hidden className="size-3.5 text-status-attention-fg" />
            <TimeAgo at={request.requestedAt} prefix="Waiting " elapsed />
          </span>
        </div>
        <div className="space-y-1.5 px-5 pt-3 pb-5">
          <p className="text-[18px] leading-[26px] font-medium tracking-[-0.01em] text-heading">{request.question}</p>
          <p className="text-[13px] text-muted-foreground">The dev-plan run is paused until you answer. Edit the tasks below; your edited list replaces the proposal.</p>
        </div>
      </div>

      {tasksText.isPending && tasksRef ? (
        <div className="card-surface space-y-2 rounded-2xl p-5" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : proposal ? (
        <PlanReviewBody key={`${runId}:${request.id}`} projectId={projectId} bundle={bundle} runId={runId} request={request} proposal={proposal} round={round} />
      ) : (
        <Notice tone="danger">The request has no readable task list{tasksText.error ? `: ${tasksText.error.message}` : ""}. Answer it from the Requests tab instead.</Notice>
      )}
    </section>
  );
}

/** Unsent review edits for one plan:review request, kept in this tab's sessionStorage. */
interface PlanDraft {
  tasks: PlannedTask[];
  feedback: string;
  notes: string;
}

const draftKey = (runId: string, requestId: string) => `u3.plan-draft:${runId}:${requestId}`;

function readDraft(key: string): PlanDraft | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<PlanDraft> | null;
    if (!data || !Array.isArray(data.tasks) || !data.tasks.every((t) => t && typeof t === "object" && typeof t.id === "string" && Array.isArray(t.acceptanceCriteria))) return null;
    return { tasks: data.tasks, feedback: typeof data.feedback === "string" ? data.feedback : "", notes: typeof data.notes === "string" ? data.notes : "" };
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: PlanDraft | null): void {
  try {
    if (draft) window.sessionStorage.setItem(key, JSON.stringify(draft));
    else window.sessionStorage.removeItem(key);
  } catch {
    // storage unavailable (private mode, quota): the edits live in memory only
  }
}

function PlanReviewBody({ projectId, bundle, runId, request, proposal, round }: { projectId: string; bundle: ProjectBundle; runId: string; request: HumanState; proposal: PlannedTask[]; round: number }) {
  const key = draftKey(runId, request.id);
  // Data views render only after hydration (useProject), so reading sessionStorage here is safe.
  const [restored] = useState(() => readDraft(key));
  const [tasks, setTasks] = useState<PlannedTask[]>(restored?.tasks ?? proposal);
  const [feedback, setFeedback] = useState(restored?.feedback ?? "");
  const [notes, setNotes] = useState(restored?.notes ?? "");
  const [answered, setAnswered] = useState(false);
  const answer = useAnswerRequest({
    runId,
    requestId: request.id,
    projectId,
    onAnswered: () => {
      writeDraft(key, null);
      setAnswered(true);
    },
  });
  const repos = useMemo(() => systemRows(bundle).map((r) => r.system).filter(isRepoName), [bundle]);
  const epics: Epic[] = bundle.epics;
  const report = findAttachment(request, "plan report");
  const file = fileSubject(request);
  const [fileOpen, setFileOpen] = useState(false);
  const edited = !samePlan(tasks, proposal);
  const dirty = !answered && (edited || !!feedback.trim() || !!notes.trim());
  const locked = answer.pending || answered;

  useEffect(() => {
    writeDraft(key, dirty ? { tasks, feedback, notes } : null);
  }, [key, dirty, tasks, feedback, notes]);

  return (
    <>
      <LeaveGuard
        active={dirty}
        title="Leave with unsent plan edits?"
        body="Your changes to the plan are not sent to dev-plan yet. They stay saved in this browser tab and come back when you return to this review; closing the tab loses them."
      />
      <SectionCard
        density="dense"
        title="Tasks by wave"
        description={
          <>
            <span className="text-heading">Round {round}, proposed by dev-plan.</span>{" "}
            Edit titles, repos, sizes and acceptance criteria, add or delete tasks, and move tasks between waves with each row&apos;s menu
            <span className="hidden md:pointer-fine:inline"> or by dragging the grip</span>. Waves run in order; tasks inside a wave run in parallel when their dependencies are done.
          </>
        }
      >
        {restored && edited ? (
          <Notice tone="review" icon={Pencil} className="mb-3">
            Restored your unsent edits to this plan. Reset to the proposal to start over.
          </Notice>
        ) : null}
        <PlanEditor tasks={tasks} onChange={setTasks} proposal={proposal} epics={epics} repos={repos} disabled={locked} />
      </SectionCard>

      {report ? (
        <SectionCard density="dense" title="What the planner assumed and could not cover" description="Plan report">
          <BlobContent blobRef={report.ref}>{(text) => <DraftReportTabs markdown={text} emptyText="The planner reported nothing." />}</BlobContent>
        </SectionCard>
      ) : null}

      {file ? (
        <Collapsible open={fileOpen} onOpenChange={setFileOpen} className="card-surface rounded-2xl">
          <CollapsibleTrigger className="flex min-h-14 w-full items-center gap-2 rounded-2xl px-5 py-3 text-left text-sm outline-none hover:bg-foreground/[0.025] focus-visible:ring-3 focus-visible:ring-ring/50">
            {fileOpen ? <ChevronDown aria-hidden className="size-4 text-muted-foreground" /> : <ChevronRight aria-hidden className="size-4 text-muted-foreground" />}
            <FileText aria-hidden className="size-4 text-muted-foreground" />
            <span className="font-medium text-heading">Plan file</span>
            <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{file.path}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="relative max-h-[60vh] overflow-y-auto border-t border-rule px-5 py-4">
              {fileOpen ? <BlobContent blobRef={file.ref}>{(text) => <Markdown source={text} size="sm" />}</BlobContent> : null}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <PlanDecision
        runId={runId}
        request={request}
        tasks={tasks}
        proposal={proposal}
        feedback={feedback}
        onFeedback={setFeedback}
        notes={notes}
        onNotes={setNotes}
        answer={answer}
        locked={locked}
      />
    </>
  );
}

function PlanDecision({
  runId,
  request,
  tasks,
  proposal,
  feedback,
  onFeedback,
  notes,
  onNotes,
  answer: { submit, pending, error, clearError },
  locked,
}: {
  runId: string;
  request: HumanState;
  tasks: PlannedTask[];
  proposal: PlannedTask[];
  feedback: string;
  onFeedback: (v: string) => void;
  notes: string;
  onNotes: (v: string) => void;
  answer: ReturnType<typeof useAnswerRequest>;
  locked: boolean;
}) {
  const [decision, setDecision] = useState<"approve" | "revise" | "">("");
  const [start, setStart] = useState<StartMode>("all-waves");
  const decisionId = useId();
  const startId = useId();
  const feedbackId = useId();
  const notesId = useId();

  const edited = !samePlan(tasks, proposal);
  const errors = planIssues(tasks).filter((i) => i.level === "error");
  const newNotes = notes
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const waves = wavesOf(tasks).length;

  const answer: PlanReviewAnswer | null =
    decision === "approve"
      ? { decision, start, ...(edited ? { tasks: cleanPlan(tasks) } : {}) }
      : decision === "revise"
        ? { decision, ...(feedback.trim() ? { feedback: feedback.trim() } : {}), ...(newNotes.length ? { newNotes } : {}), ...(edited ? { tasks: cleanPlan(tasks) } : {}) }
        : null;
  const missing = [
    ...(decision ? [] : ["Choose Approve or Revise"]),
    ...(decision === "approve" && errors.length ? [`Fix ${plural(errors.length, "problem")} in the plan first`] : []),
    ...(decision === "revise" && !feedback.trim() && !newNotes.length && !edited ? ["Say what to change, add a note or edit the tasks"] : []),
  ];

  return (
    <section aria-label="Plan decision" className="card-surface space-y-5 rounded-2xl p-5">
      <div className="space-y-1">
        <h3 className="text-[20px] leading-7 font-medium tracking-[-0.015em] text-heading">Decision</h3>
        <p className="text-[13px] text-muted-foreground">
          {plural(tasks.length, "task")} in {plural(waves, "wave")}
          {edited ? " · your edits are sent with the answer" : " · the proposal as is"}
        </p>
      </div>

      <FormRow label="Decision" id={decisionId} required>
        <PillChoice
          value={decision}
          onChange={(v) => {
            clearError();
            setDecision(v);
          }}
          ariaLabelledBy={decisionId}
          disabled={locked}
          options={[
            { value: "approve", label: "Approve plan & start agents", icon: CheckCircle2 },
            { value: "revise", label: "Revise with notes", icon: RotateCcw },
          ]}
        />
      </FormRow>

      {decision === "approve" ? (
        <FormRow label="Start" id={startId} hint="Agents run at most 3 tasks at once and wait for each task's dependencies.">
          <Select value={start} onValueChange={(v) => setStart(v as StartMode)} disabled={locked}>
            <SelectTrigger className="w-full max-w-72" aria-labelledby={startId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(START_MODE_LABELS) as StartMode[]).map((m) => (
                <SelectItem key={m} value={m}>
                  {START_MODE_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormRow>
      ) : null}

      {decision === "revise" ? (
        <div className="grid gap-4 @container">
          <FormRow label="Feedback" htmlFor={feedbackId} hint="What the next planning round should change">
            <Textarea id={feedbackId} rows={3} value={feedback} onChange={(e) => {
                clearError();
                onFeedback(e.target.value);
              }} disabled={locked} placeholder="e.g. Split T-4 so the contract change lands before the endpoint." />
          </FormRow>
          <FormRow label="New developer notes" htmlFor={notesId} hint="One per line; kept for later runs">
            <Textarea id={notesId} rows={2} value={notes} onChange={(e) => {
                clearError();
                onNotes(e.target.value);
              }} disabled={locked} />
          </FormRow>
        </div>
      ) : null}

      {decision === "approve" && errors.length ? (
        <Notice tone="danger">
          {plural(errors.length, "problem")} to fix: {errors.slice(0, 3).map((e) => (e.taskId ? `${e.taskId} ${e.text}` : e.text)).join("; ")}
          {errors.length > 3 ? "; …" : ""}
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-rule pt-4">
        {missing.length ? <p className="mr-auto text-[13px] text-muted-foreground">{missing[0]}</p> : <p className="mr-auto text-[13px] text-muted-foreground">Answers {request.id} and resumes run {runId}.</p>}
        <Button disabled={!answer || missing.length > 0 || locked} onClick={() => answer && submit(answer)}>
          {pending ? <Spinner aria-hidden /> : null}
          {decision === "revise" ? "Send for revision" : decision === "approve" ? "Approve plan & start agents" : "Answer"}
          {decision === "approve" ? <ArrowRight aria-hidden /> : null}
        </Button>
      </div>
    </section>
  );
}
