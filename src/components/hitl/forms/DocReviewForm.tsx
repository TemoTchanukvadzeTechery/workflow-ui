"use client";

/**
 * review:<round> (po-brd / architect-aad, kind "review", phase "Draft <round>"). The subject is
 * the BRD/AAD file in edit mode: the reviewer may edit it directly (sent as reviewEdit with the
 * subject's sha256; the human's edits win in the next round), read the draft report, and accept
 * or ask for a revision with feedback and extra notes.
 */
import { CheckCircle2, ChevronDown, ChevronRight, PencilLine, RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useBlobText } from "@/lib/api/queries";
import { splitLines } from "@/lib/weft/schema-form";
import type { DocReviewAnswer } from "@/lib/weft/workflows";
import { DocViewer } from "../../docs/DocViewer";
import { DraftReportTabs } from "../../docs/DraftReportTabs";
import { changedLineCount, TextDiff } from "../../docs/TextDiff";
import { CircleIconButton, FloatingChip } from "@/components/common";
import { Notice, TonePill } from "../bits";
import { BlobContent } from "../BlobContent";
import { FormRow, PillChoice } from "../controls";
import { keyNumber, parseDocQuestion } from "../parse";
import { RequestFooter } from "../RequestFooter";
import { fileSubject, findAttachment, type RequestFormProps } from "../types";
import { useAnswerRequest } from "../use-answer-request";

function maxRoundsOf(input: unknown): number | undefined {
  const n = (input as { maxRounds?: unknown } | undefined)?.maxRounds;
  return typeof n === "number" ? n : undefined;
}

export function DocReviewForm({ request, run, projectId, compact, onAnswered }: RequestFormProps) {
  const file = fileSubject(request);
  const original = useBlobText(file?.ref.$blob);
  const report = findAttachment(request, "draft report");
  const facts = parseDocQuestion(request.question);
  const round = keyNumber(request.key) ?? facts.round ?? 1;
  const maxRounds = maxRoundsOf(run?.input);
  const docLabel = facts.doc ?? (run?.workflow === "architect-aad" ? "AAD" : "BRD");

  const [decision, setDecision] = useState<DocReviewAnswer["decision"] | "">("");
  const [feedback, setFeedback] = useState("");
  const [notes, setNotes] = useState("");
  const [edited, setEdited] = useState<string | undefined>(undefined);
  const [docOpen, setDocOpen] = useState(!compact);
  const [showEdits, setShowEdits] = useState(false);
  const feedbackId = useId();
  const notesId = useId();
  const decisionId = useId();
  const { submit, pending, error, clearError } = useAnswerRequest({ runId: request.runId, requestId: request.id, projectId, onAnswered });

  const base = original.data;
  const editedLines = base !== undefined && edited !== undefined ? changedLineCount(base, edited) : 0;
  const reviewEdit = file && file.mode === "edit" && base !== undefined && edited !== undefined && edited !== base ? { content: edited, beforeSha256: file.sha256 } : undefined;

  const newNotes = splitLines(notes);
  const answer: DocReviewAnswer | Record<string, never> = decision
    ? {
        decision,
        ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
        ...(newNotes.length > 0 ? { newNotes } : {}),
      }
    : {};
  const missing = [...(decision ? [] : [`Choose Accept or Revise`]), ...(file?.mode === "edit" && base === undefined ? ["Loading the document"] : [])];
  const lastRound = maxRounds !== undefined && round >= maxRounds;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
        <FloatingChip label="Round" value={maxRounds ? `${round} of ${maxRounds}` : String(round)} tone="running" />
        {/* Counts from the question text; the question itself is shown verbatim elsewhere (po-brd main.ts). */}
        {facts.blockingQuestions !== undefined ? <span>{facts.blockingQuestions} blocking {facts.blockingQuestions === 1 ? "question" : "questions"}</span> : null}
        {facts.conflicts !== undefined ? <span>· {facts.conflicts} {facts.conflicts === 1 ? "conflict" : "conflicts"}</span> : null}
        {facts.decisionsNeeded !== undefined ? <span>· {facts.decisionsNeeded} {facts.decisionsNeeded === 1 ? "decision" : "decisions"} needed</span> : null}
        {editedLines > 0 ? (
          <TonePill tone="review" icon={PencilLine}>
            You edited {editedLines} {editedLines === 1 ? "line" : "lines"} — your edits are kept
          </TonePill>
        ) : null}
      </div>

      {file ? (
        compact && !docOpen ? (
          <button
            type="button"
            onClick={() => setDocOpen(true)}
            className="flex min-h-11 w-full items-center gap-2 rounded-[16px] bg-well px-3.5 py-2 text-left text-sm text-heading transition-colors hover:bg-well-hover focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <ChevronRight aria-hidden className="size-4" />
            <span className="flex-1">Open {docLabel} to read or edit</span>
            <span className="truncate font-mono text-xs text-muted-foreground">{file.path}</span>
          </button>
        ) : (
          <DocViewer
            title={`${docLabel} draft · round ${round}`}
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
            compareLabel="the agent's draft"
            toc={!compact}
            variant="panel"
            bodyClassName={compact ? "max-h-[50vh]" : "max-h-[70vh]"}
            headerExtra={
              compact ? (
                <CircleIconButton size="sm" icon={ChevronDown} label="Collapse document" onClick={() => setDocOpen(false)} />
              ) : undefined
            }
          />
        )
      ) : null}
      {original.isError ? <Notice tone="danger" role="alert">Could not load {file?.path}: {original.error.message}</Notice> : null}

      {report ? (
        <section aria-label="Draft report" className="space-y-3">
          <h4 className="text-sm font-medium text-heading">Draft report</h4>
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
            { value: "accept", label: "Accept", icon: CheckCircle2 },
            { value: "revise", label: "Revise", icon: RotateCcw },
          ]}
        />
        {decision === "accept" ? (
          <p className="text-[13px] text-muted-foreground">Accept ends drafting. The workflow then proposes a shared-memory update for you to review.{editedLines > 0 ? " Your edits are saved as the accepted text." : ""}</p>
        ) : decision === "revise" ? (
          <p className="text-[13px] text-muted-foreground">
            Revise runs round {round + 1}
            {lastRound ? ", but this is the last round: the run will end with the document not accepted and memory left unchanged" : ""}.
          </p>
        ) : null}
      </FormRow>

      <FormRow label="Feedback" htmlFor={feedbackId} hint="What to change in the next round">
        <Textarea id={feedbackId} rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} disabled={pending} placeholder="e.g. Keep individual lookup out of scope; Legal confirmed aggregate-only." />
        {decision === "revise" && !feedback.trim() && editedLines === 0 ? (
          <Notice className="mt-2">No feedback and no edits: the next round has nothing new to act on. The workflow does not require feedback, so you can still send it.</Notice>
        ) : null}
      </FormRow>

      <FormRow label="New notes" htmlFor={notesId} hint="Note text or a repo path (notes/legal-call.md), one per line. They are added as sources for the next round.">
        <Textarea id={notesId} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={pending} className="font-mono text-[13px]" placeholder={"notes/legal-call.md\nLegal confirmed aggregate-only"} />
      </FormRow>

      {editedLines > 0 && base !== undefined && edited !== undefined ? (
        <div className="space-y-2">
          <button type="button" onClick={() => setShowEdits((s) => !s)} aria-expanded={showEdits} className="inline-flex h-8 items-center gap-1 rounded-[10px] px-1.5 text-[13px] text-muted-foreground hover:text-heading focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            {showEdits ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
            {showEdits ? "Hide my edits" : "Preview my edits"}
          </button>
          {showEdits ? <TextDiff before={base} after={edited} maxHeightClass="max-h-80" /> : null}
        </div>
      ) : null}

      <RequestFooter requestId={request.id} answer={answer} reviewEdit={reviewEdit} error={error} pending={pending} missing={missing} onSubmit={() => decision && submit(answer, reviewEdit)} />
    </div>
  );
}
