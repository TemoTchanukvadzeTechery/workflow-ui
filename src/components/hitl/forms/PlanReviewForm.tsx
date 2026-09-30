"use client";

/**
 * plan:review:<round> (dev-plan, kind "review", phase "Plan <round>"). Subject: the plan file in
 * edit mode; attachments "plan report" (markdown) and "tasks" (application/json PlannedTask[]).
 * Approve starts the agents in the chosen start mode; Revise runs another planning round. When a
 * PlanEditor upstream edited the tasks it passes them as editedTasks and they are sent as `tasks`.
 */
import { CheckCircle2, RotateCcw } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useBlobText } from "@/lib/api/queries";
import { splitLines } from "@/lib/weft/schema-form";
import type { PlannedTask, PlanReviewAnswer } from "@/lib/weft/workflows";
import { DocViewer } from "../../docs/DocViewer";
import { DraftReportTabs } from "../../docs/DraftReportTabs";
import { FloatingChip } from "@/components/common";
import { MonoChip, Notice, TonePill } from "../bits";
import { BlobContent } from "../BlobContent";
import { FormRow, PillChoice } from "../controls";
import { keyNumber, parsePlanQuestion } from "../parse";
import { RequestFooter } from "../RequestFooter";
import { fileSubject, findAttachment, type RequestFormProps } from "../types";
import { useAnswerRequest } from "../use-answer-request";

export type StartMode = NonNullable<PlanReviewAnswer["start"]>;
export const START_MODE_LABELS: Record<StartMode, string> = {
  "all-waves": "All waves automatically",
  "first-wave": "First wave only",
  manual: "Manually, task by task",
};

function parseTasks(text: string | undefined): PlannedTask[] | null {
  if (!text) return null;
  try {
    const data = JSON.parse(text) as unknown;
    return Array.isArray(data) ? (data as PlannedTask[]) : null;
  } catch {
    return null;
  }
}

/** Read-only tasks grouped by wave. */
export function PlanTasksTable({ tasks }: { tasks: PlannedTask[] }) {
  const waves = useMemo(() => {
    const by = new Map<number, PlannedTask[]>();
    for (const t of tasks) by.set(t.wave, [...(by.get(t.wave) ?? []), t]);
    return [...by.entries()].sort((a, b) => a[0] - b[0]);
  }, [tasks]);
  return (
    <div className="space-y-5">
      {waves.map(([wave, list]) => (
        <div key={wave} className="relative overflow-x-auto">
          {/* Fixed layout so every wave table lines its columns up with the others. */}
          <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
            <caption className="pb-1 text-left text-sm font-medium text-heading">
              Wave {wave} <span className="font-normal text-muted-foreground">· {list.length} {list.length === 1 ? "task" : "tasks"}</span>
            </caption>
            <thead className="text-left text-[13px] text-muted-foreground">
              <tr className="border-b border-rule">
                <th scope="col" className="h-10 px-3 font-normal first:pl-1">
                  Task
                </th>
                <th scope="col" className="h-10 w-48 px-3 font-normal">
                  Repo
                </th>
                <th scope="col" className="h-10 w-14 px-3 font-normal">
                  Size
                </th>
                <th scope="col" className="h-10 w-28 px-3 font-normal">
                  Depends on
                </th>
                <th scope="col" className="h-10 w-32 px-3 font-normal">
                  Traces
                </th>
                <th scope="col" className="h-10 w-14 px-3 text-right font-normal">
                  ACs
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id} className="border-b border-rule align-top transition-colors last:border-b-0 hover:bg-foreground/[0.025]">
                  <td className="py-3 pr-3 pl-1">
                    <div className="flex items-baseline gap-2">
                      <span className="shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">{t.id}</span>
                      <span className="font-medium text-heading">{t.title}</span>
                    </div>
                    {t.blockedBy ? <div className="mt-0.5 text-xs text-status-attention-fg">Blocked by {t.blockedBy}</div> : null}
                  </td>
                  <td className="px-3 py-3">
                    <MonoChip className="max-w-full truncate" title={t.repo}>
                      {t.repo}
                    </MonoChip>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">{t.size}</td>
                  <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{t.dependencies.length > 0 ? t.dependencies.join(", ") : "none"}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {t.traces.map((tr) => (
                        <MonoChip key={tr}>{tr}</MonoChip>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">{t.acceptanceCriteria.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function PlanReviewForm({ request, projectId, compact, onAnswered, editedTasks }: RequestFormProps & { editedTasks?: PlannedTask[] }) {
  const file = fileSubject(request);
  const original = useBlobText(file?.ref.$blob);
  const report = findAttachment(request, "plan report");
  const tasksAttachment = findAttachment(request, "tasks");
  const tasksText = useBlobText(tasksAttachment?.ref.$blob);
  const proposed = parseTasks(tasksText.data);
  const facts = parsePlanQuestion(request.question);
  const round = keyNumber(request.key) ?? facts.round ?? 1;

  const [decision, setDecision] = useState<PlanReviewAnswer["decision"] | "">("");
  const [start, setStart] = useState<StartMode>("all-waves");
  const [feedback, setFeedback] = useState("");
  const [notes, setNotes] = useState("");
  const [edited, setEdited] = useState<string | undefined>(undefined);
  const decisionId = useId();
  const startId = useId();
  const feedbackId = useId();
  const notesId = useId();
  const { submit, pending, error, clearError } = useAnswerRequest({ runId: request.runId, requestId: request.id, projectId, onAnswered });

  const base = original.data;
  const reviewEdit = file && file.mode === "edit" && base !== undefined && edited !== undefined && edited !== base ? { content: edited, beforeSha256: file.sha256 } : undefined;
  const newNotes = splitLines(notes);
  const answer: PlanReviewAnswer | Record<string, never> =
    decision === "approve"
      ? { decision, start, ...(editedTasks ? { tasks: editedTasks } : {}) }
      : decision === "revise"
        ? { decision, ...(feedback.trim() ? { feedback: feedback.trim() } : {}), ...(newNotes.length > 0 ? { newNotes } : {}), ...(editedTasks ? { tasks: editedTasks } : {}) }
        : {};
  const missing = [...(decision ? [] : ["Choose Approve or Revise"]), ...(file?.mode === "edit" && base === undefined ? ["Loading the plan"] : [])];
  const shownTasks = editedTasks ?? proposed;
  const waves = shownTasks ? new Set(shownTasks.map((t) => t.wave)).size : facts.waves;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
        <FloatingChip label="Round" value={String(round)} tone="running" />
        {shownTasks ? (
          <span>
            {shownTasks.length} tasks in {waves} waves
          </span>
        ) : facts.tasks !== undefined ? (
          <span>
            {facts.tasks} tasks in {facts.waves} waves
          </span>
        ) : null}
        {facts.openQuestions !== undefined ? <span>· {facts.openQuestions} open questions</span> : null}
        {editedTasks ? <TonePill tone="review">Tasks edited in the plan editor; your list is sent</TonePill> : null}
      </div>

      {file ? (
        <DocViewer
          title={`Implementation plan · round ${round}`}
          path={file.path}
          text={base ?? ""}
          loading={original.isPending}
          editable={file.mode === "edit"}
          value={edited}
          onChange={(t) => {
            clearError();
            setEdited(t);
          }}
          compareText={edited !== undefined && edited !== base ? base : undefined}
          compareLabel="the proposed plan"
          toc={!compact}
          variant="panel"
          bodyClassName="max-h-[50vh]"
        />
      ) : null}

      {shownTasks ? (
        <section aria-label="Tasks" className="space-y-3">
          <h4 className="text-sm font-medium text-heading">Tasks</h4>
          <PlanTasksTable tasks={shownTasks} />
        </section>
      ) : tasksAttachment && tasksText.data !== undefined ? (
        <Notice tone="danger">The tasks attachment is not a task list.</Notice>
      ) : null}

      {report ? (
        <section aria-label="Plan report" className="space-y-3">
          <h4 className="text-sm font-medium text-heading">Plan report</h4>
          <BlobContent blobRef={report.ref}>{(text) => <DraftReportTabs markdown={text} />}</BlobContent>
        </section>
      ) : null}

      <FormRow label="Decision" id={decisionId} required>
        <PillChoice
          value={decision}
          onChange={(v) => {
            clearError();
            setDecision(v);
          }}
          ariaLabelledBy={decisionId}
          disabled={pending}
          options={[
            { value: "approve", label: "Approve plan & start agents", icon: CheckCircle2 },
            { value: "revise", label: "Revise", icon: RotateCcw },
          ]}
        />
      </FormRow>

      {decision === "approve" ? (
        <FormRow label="Start" id={startId} hint="Agents run at most 3 tasks at once and respect dependencies.">
          <Select value={start} onValueChange={(v) => setStart(v as StartMode)} disabled={pending}>
            <SelectTrigger className="min-w-56" aria-labelledby={startId}>
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
        <>
          <FormRow label="Feedback" htmlFor={feedbackId} hint="What to change in the next planning round">
            <Textarea id={feedbackId} rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} disabled={pending} placeholder="e.g. Split T-4 so the contract change lands before the endpoint." />
            {!feedback.trim() && !reviewEdit && !editedTasks ? <Notice className="mt-2">No feedback and no edits: the next round has nothing new to act on.</Notice> : null}
          </FormRow>
          <FormRow label="New developer notes" htmlFor={notesId} hint="One per line">
            <Textarea id={notesId} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={pending} />
          </FormRow>
        </>
      ) : null}

      <RequestFooter requestId={request.id} answer={answer} reviewEdit={reviewEdit} error={error} pending={pending} missing={missing} onSubmit={() => decision && submit(answer, reviewEdit)} />
    </div>
  );
}
