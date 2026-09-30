"use client";

/**
 * qa:review:<attempt> (qa-verify, kind "review", phase "Certify"). Subject: the evidence file
 * .deliver/evidence/<repo>/<KEY>.md (view mode); attachment "test plan". The verdict is an anyOf
 * of consts with descriptions, so it renders as cards; Bugs found reveals a bug list (one per
 * line) that becomes the feedback of the loop-back dev-task run. Blocked needs a comment saying
 * what blocks testing: it is shown on the task until QA re-tests.
 */
import { Ban, BadgeCheck, Bug, type LucideIcon } from "lucide-react";
import { useId, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { optionsOf, splitLines } from "@/lib/weft/schema-form";
import type { JsonSchema } from "@/lib/weft/types";
import type { QaReviewAnswer } from "@/lib/weft/workflows";
import { Markdown } from "../../docs/Markdown";
import { FloatingChip } from "@/components/common";
import { TonePill, type Tone } from "../bits";
import { BlobContent } from "../BlobContent";
import { FormRow, OptionCards } from "../controls";
import { keyNumber, parseQaQuestion } from "../parse";
import { RequestFooter } from "../RequestFooter";
import { fileSubject, findAttachment, type RequestFormProps } from "../types";
import { useAnswerRequest } from "../use-answer-request";

type Verdict = QaReviewAnswer["verdict"];

export const QA_VERDICT_META: Record<Verdict, { label: string; icon: LucideIcon; tone: Tone }> = {
  "ready-for-po-review": { label: "Ready for PO review", icon: BadgeCheck, tone: "success" },
  "bugs-found": { label: "Bugs found", icon: Bug, tone: "danger" },
  blocked: { label: "Blocked", icon: Ban, tone: "attention" },
};

/** "Result: Ready for PO review" as icon + text. */
export function QaVerdictLabel({ verdict, prefix = "Result: " }: { verdict: Verdict; prefix?: string }) {
  const meta = QA_VERDICT_META[verdict];
  return (
    <TonePill tone={meta.tone} icon={meta.icon}>
      {prefix}
      {meta.label}
    </TonePill>
  );
}

export function QaReviewForm({ request, projectId, onAnswered }: RequestFormProps) {
  const facts = parseQaQuestion(request.question);
  const attempt = keyNumber(request.key) ?? 1;
  const file = fileSubject(request);
  const testPlan = findAttachment(request, "test plan");
  const verdictProp = (request.schema as { properties?: Record<string, JsonSchema> }).properties?.verdict;
  const described = new Map(verdictProp ? optionsOf(verdictProp).map((o) => [o.value, o.description]) : []);
  const [verdict, setVerdict] = useState<Verdict | "">("");
  const [comment, setComment] = useState("");
  const [bugs, setBugs] = useState("");
  const verdictId = useId();
  const commentId = useId();
  const bugsId = useId();
  const { submit, pending, error, clearError } = useAnswerRequest({ runId: request.runId, requestId: request.id, projectId, onAnswered });

  const bugList = splitLines(bugs);
  const answer: QaReviewAnswer | Record<string, never> = verdict
    ? { verdict, ...(comment.trim() ? { comment: comment.trim() } : {}), ...(verdict === "bugs-found" && bugList.length > 0 ? { bugs: bugList } : {}) }
    : {};
  const missing = [
    ...(verdict ? [] : ["Choose a verdict"]),
    ...(verdict === "bugs-found" && bugList.length === 0 ? ["List at least one bug"] : []),
    ...(verdict === "blocked" && !comment.trim() ? ["Say what blocks testing"] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
        {facts.taskKey ? <span className="font-mono text-xs text-heading">{facts.taskKey}</span> : null}
        <FloatingChip label="Attempt" value={String(attempt)} tone="running" />
        {facts.total !== undefined ? (
          <span>
            {facts.met}/{facts.total} acceptance criteria met · {facts.evidence} evidence items ({facts.automated} automated, {facts.manual} manual)
          </span>
        ) : null}
      </div>

      {file || testPlan ? (
        <Tabs defaultValue={file ? "evidence" : "plan"} className="min-w-0 gap-3">
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <TabsList className="justify-start">
              {file ? (
                <TabsTrigger value="evidence" className="h-9 flex-none px-3.5">
                  Evidence report
                </TabsTrigger>
              ) : null}
              {testPlan ? (
                <TabsTrigger value="plan" className="h-9 flex-none px-3.5">
                  Test plan
                </TabsTrigger>
              ) : null}
            </TabsList>
          </div>
          {file ? (
            <TabsContent value="evidence" className="min-w-0">
              <p className="mb-2 font-mono text-xs text-muted-foreground">{file.path}</p>
              <div className="relative max-h-[60vh] overflow-y-auto rounded-[20px] bg-field px-5 py-4 shadow-[0_0_0_1px_var(--rule)]">
                <BlobContent blobRef={file.ref}>{(t) => <Markdown source={t} size="sm" />}</BlobContent>
              </div>
            </TabsContent>
          ) : null}
          {testPlan ? (
            <TabsContent value="plan" className="min-w-0">
              <BlobContent blobRef={testPlan.ref}>{(t) => <Markdown source={t} size="sm" />}</BlobContent>
            </TabsContent>
          ) : null}
        </Tabs>
      ) : null}

      <FormRow label="Verdict" id={verdictId} required>
        <OptionCards
          value={verdict}
          onChange={(v) => {
            clearError();
            setVerdict(v);
          }}
          ariaLabelledBy={verdictId}
          disabled={pending}
          options={(Object.keys(QA_VERDICT_META) as Verdict[]).map((v) => ({
            value: v,
            title: QA_VERDICT_META[v].label,
            description: described.get(v) || undefined,
            icon: QA_VERDICT_META[v].icon,
            tone: QA_VERDICT_META[v].tone,
          }))}
        />
        {verdict ? (
          <div className="pt-1">
            <QaVerdictLabel verdict={verdict} />
          </div>
        ) : null}
      </FormRow>

      {verdict === "bugs-found" ? (
        <FormRow label="Bugs" htmlFor={bugsId} required hint="One bug per line. They go back to implementation as the rework feedback; QA runs again after the developer approves the fix.">
          <Textarea
            id={bugsId}
            rows={4}
            value={bugs}
            onChange={(e) => {
              clearError();
              setBugs(e.target.value);
            }}
            disabled={pending}
            placeholder={"AC-2: export omits ambassadors with no acceptance record\nAC-4: CSV header uses the internal column name"}
          />
        </FormRow>
      ) : null}

      <FormRow
        label="Comment"
        htmlFor={commentId}
        required={verdict === "blocked"}
        hint={verdict === "blocked" ? "Say what blocks testing. It is shown on the task as the reason; re-test the task once the blocker is resolved." : "Notes for the developer and the PO"}
      >
        <Textarea
          id={commentId}
          rows={2}
          value={comment}
          onChange={(e) => {
            clearError();
            setComment(e.target.value);
          }}
          disabled={pending}
          placeholder={verdict === "blocked" ? "Test environment is down." : undefined}
        />
      </FormRow>

      <RequestFooter requestId={request.id} answer={answer} error={error} pending={pending} missing={missing} onSubmit={() => verdict && submit(answer)} />
    </div>
  );
}
