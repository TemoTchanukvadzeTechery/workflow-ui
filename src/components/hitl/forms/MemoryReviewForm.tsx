"use client";

/**
 * memory:review (or memory:review:rebase), kind "review", phase "Update memory". The subject is
 * the proposed memory/memory.md; attachments are "diff" ("+ "/"- " lines) and "changes"
 * (## Changes: "- <kind>: <summary>", ## Affects other documents). Three answers:
 * Apply {decision:"apply"}, Apply my edited version {decision:"apply", replacement}, Discard.
 */
import { CheckCircle2, PencilLine, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBlobText } from "@/lib/api/queries";
import type { MemoryReviewAnswer } from "@/lib/weft/workflows";
import { Markdown } from "../../docs/Markdown";
import { parseReportSections } from "../../docs/DraftReportTabs";
import { changedLineCount } from "../../docs/TextDiff";
import { Notice, TonePill } from "../bits";
import { BlobContent, renderText } from "../BlobContent";
import { FormRow, OptionCards } from "../controls";
import { parseChangeItem, parseMemoryQuestion } from "../parse";
import { RequestFooter } from "../RequestFooter";
import { artifactSubject, findAttachment, type RequestFormProps } from "../types";
import { useAnswerRequest } from "../use-answer-request";

type Choice = "apply" | "apply-edited" | "discard";

function ChangesList({ markdown, section }: { markdown: string; section: "changes" | "affects" }) {
  const sections = parseReportSections(markdown);
  const found = sections.find((s) => (section === "changes" ? /^changes$/i.test(s.title) : /affects/i.test(s.title)));
  const items = found?.items ?? [];
  if (items.length === 0) return <p className="rounded-lg bg-muted/50 px-3 py-4 text-center text-[13px] text-muted-foreground">None.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => {
        const c = section === "changes" ? parseChangeItem(item) : { summary: item };
        return (
          <li key={i} className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2 @lg:flex-row @lg:items-start @lg:gap-3">
            {c.kind ? <span className="inline-flex h-5 w-fit shrink-0 items-center rounded-full bg-muted px-2 font-mono text-[11px] text-muted-foreground">{c.kind}</span> : null}
            <Markdown source={c.summary} size="sm" className="[&_p]:my-0" />
          </li>
        );
      })}
    </ul>
  );
}

export function MemoryReviewForm({ request, projectId, onAnswered, stale }: RequestFormProps & { stale?: string[] }) {
  const facts = parseMemoryQuestion(request.question);
  const proposal = artifactSubject(request);
  const proposalText = useBlobText(proposal?.ref.$blob);
  const diff = findAttachment(request, "diff");
  const changes = findAttachment(request, "changes");
  const changesText = useBlobText(changes?.ref.$blob);
  const [choice, setChoice] = useState<Choice | "">("");
  const [replacement, setReplacement] = useState<string | undefined>(undefined);
  const editorId = useId();
  const choiceId = useId();
  const { submit, pending, error, clearError } = useAnswerRequest({ runId: request.runId, requestId: request.id, projectId, onAnswered });

  const editedText = replacement ?? proposalText.data ?? "";
  const editedLines = proposalText.data !== undefined && replacement !== undefined ? changedLineCount(proposalText.data, replacement) : 0;
  const answer: MemoryReviewAnswer | Record<string, never> =
    choice === "apply" ? { decision: "apply" } : choice === "discard" ? { decision: "discard" } : choice === "apply-edited" ? (editedLines > 0 ? { decision: "apply", replacement: editedText } : { decision: "apply" }) : {};
  const missing = choice ? [] : ["Choose Apply, Apply my edited version or Discard"];
  const changeCount = changesText.data ? (parseReportSections(changesText.data).find((s) => /^changes$/i.test(s.title))?.items.length ?? facts.changes) : facts.changes;
  const affectCount = changesText.data ? parseReportSections(changesText.data).find((s) => /affects/i.test(s.title))?.items.length : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <TonePill tone={facts.major ? "attention" : "neutral"}>{facts.major ? "Major update" : "Minor update"}</TonePill>
        {facts.rebased ? <TonePill tone="review">Rebased onto a newer memory file</TonePill> : null}
        {proposal?.label ? <span className="font-mono text-xs text-muted-foreground">{proposal.label}</span> : null}
      </div>
      {stale && stale.length > 0 ? (
        <Notice>
          <p className="font-medium">Recorded documents changed since memory was written</p>
          <ul className="mt-1 list-disc pl-4">
            {stale.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <Tabs defaultValue="proposed" className="min-w-0 gap-3">
        <div className="pb-1">
          <TabsList variant="line" className="h-auto w-full flex-wrap justify-start gap-x-1 gap-y-2 group-data-horizontal/tabs:h-auto">
            {(
              [
                ["proposed", "Proposed memory"],
                ["diff", "Diff"],
                ["changes", `Changes${changeCount !== undefined ? ` · ${changeCount}` : ""}`],
                ["affects", `Affects other documents${affectCount !== undefined ? ` · ${affectCount}` : ""}`],
              ] as const
            ).map(([v, label]) => (
              <TabsTrigger key={v} value={v} className="h-8 flex-none rounded-full px-3 text-[13px] data-active:bg-muted">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="changes">{changesText.data !== undefined ? <ChangesList markdown={changesText.data} section="changes" /> : <BlobContent blobRef={changes?.ref} />}</TabsContent>
        <TabsContent value="diff">{diff ? <BlobContent blobRef={diff.ref}>{(t) => renderText(t, "text/plain")}</BlobContent> : <p className="text-[13px] text-muted-foreground">No diff attached.</p>}</TabsContent>
        <TabsContent value="proposed">
          {proposal ? (
            <div className="relative max-h-[60vh] overflow-y-auto rounded-xl border border-border px-4 py-3">
              <BlobContent blobRef={proposal.ref}>{(t) => <Markdown source={t} />}</BlobContent>
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="affects">{changesText.data !== undefined ? <ChangesList markdown={changesText.data} section="affects" /> : null}</TabsContent>
      </Tabs>

      <FormRow label="Decision" id={choiceId} required>
        <OptionCards
          value={choice}
          ariaLabelledBy={choiceId}
          disabled={pending}
          onChange={(v) => {
            clearError();
            setChoice(v);
          }}
          options={[
            { value: "apply", title: "Apply", description: "Write the proposal to the shared memory so future BRD and AAD runs see it.", icon: CheckCircle2, tone: "success" },
            { value: "apply-edited", title: "Apply my edited version", description: "Edit the proposed memory first; your text is written instead of the proposal.", icon: PencilLine, tone: "review" },
            { value: "discard", title: "Discard", description: "Leave the shared memory unchanged. The stage gate will note it.", icon: Trash2, tone: "danger" },
          ]}
        />
      </FormRow>

      {choice === "apply-edited" ? (
        <FormRow
          label="Your version of the memory"
          htmlFor={editorId}
          hint={editedLines > 0 ? `${editedLines} ${editedLines === 1 ? "line" : "lines"} changed from the proposal. Sent as replacement.` : "Prefilled with the proposal. Until you change it, this applies the proposal as is."}
        >
          <textarea
            id={editorId}
            spellCheck={false}
            value={editedText}
            disabled={pending || proposalText.data === undefined}
            onChange={(e) => {
              clearError();
              setReplacement(e.target.value);
            }}
            className="block min-h-[40vh] w-full resize-y rounded-lg border border-input bg-transparent p-3 font-mono text-xs leading-5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </FormRow>
      ) : null}

      <RequestFooter requestId={request.id} answer={answer} error={error} pending={pending} missing={missing} onSubmit={() => choice && submit(answer)} />
    </div>
  );
}
