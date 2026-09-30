"use client";

/**
 * deps:review:<pass> (po-brd / architect-aad, kind "ask", phase "Discover"). The detail lists
 * the dependencies discovery found; the reviewer unticks "Use" on some (sent as remove[]), adds
 * refs (add[]: Jira keys or Confluence page ids, sent bare because po-brd picks the kind with
 * /^\d+$/), and either continues to Draft 1 or runs another discovery pass with guidance (up to 3
 * passes). Rows whose content was not fetched (a 404) are counted apart: drafting cannot cite them.
 */
import { AlertTriangle, BookOpen, SearchCheck, SearchIcon, Ticket } from "lucide-react";
import { useId, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { parseRef, refKind } from "@/lib/weft/refs";
import type { DependencyReviewAnswer } from "@/lib/weft/workflows";
import { cn } from "@/lib/utils";
import { dependencyWhyText, relationText } from "../../projects/sources";
import { MonoChip, Notice } from "../bits";
import { ChipInput, FormRow, PillChoice } from "../controls";
import { keyNumber, parseDependencyDetail, type DependencyRow } from "../parse";
import { RequestFooter } from "../RequestFooter";
import type { RequestFormProps } from "../types";
import { useAnswerRequest } from "../use-answer-request";

const MAX_PASSES = 3;

function KindIcon({ kind }: { kind: string }) {
  const Icon = kind === "confluence" ? BookOpen : Ticket;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={kind === "confluence" ? "Confluence page" : "Jira issue"}>
      <Icon aria-hidden className="size-3.5" />
      <span className="sr-only @2xl:not-sr-only">{kind === "confluence" ? "Confluence" : "Jira"}</span>
    </span>
  );
}

function DependencyTable({ rows, removed, onToggle, disabled, workflow }: { rows: DependencyRow[]; removed: Set<string>; onToggle: (ref: string) => void; disabled?: boolean; workflow?: string }) {
  if (rows.length === 0) {
    return <p className="rounded-lg bg-muted/50 px-3 py-4 text-center text-[13px] text-muted-foreground">No dependencies found. Add references below, or search more with guidance.</p>;
  }
  return (
    <>
      {/* Narrow cards (phones, the side rail): one stacked row per dependency instead of a sideways-scrolling table. */}
      <ul className="relative divide-y divide-border rounded-xl border border-border text-[13px] @xl:hidden" aria-label="Dependencies found by discovery">
        {rows.map((row) => {
          const off = removed.has(row.ref);
          const id = `dep-s-${row.ref}`;
          const why = dependencyWhyText(row.relation, row.why, workflow);
          return (
            <li key={row.ref} className={cn("flex items-start gap-3 px-3 py-2.5", off && "bg-muted/40")}>
              <Checkbox id={id} checked={!off} onCheckedChange={() => onToggle(row.ref)} disabled={disabled} aria-label={`Use ${row.ref}`} className="mt-0.5" />
              <div className={cn("min-w-0 flex-1 space-y-1", off && "opacity-60")}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <label htmlFor={id} className={cn("font-mono text-xs", off && "line-through decoration-muted-foreground")}>
                    {row.ref}
                  </label>
                  <KindIcon kind={row.kind} />
                  <span className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-[11px] whitespace-nowrap text-muted-foreground">{relationText(row.relation)}</span>
                </div>
                <div className="font-medium break-words text-foreground">{row.title}</div>
                {why ? <div className="text-xs leading-snug text-muted-foreground">{why}</div> : null}
                {row.notFetched ? (
                  <div className="inline-flex items-center gap-1 text-xs text-status-attention-fg">
                    <AlertTriangle aria-hidden className="size-3.5" />
                    Content not fetched; drafting cannot cite it
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="relative hidden overflow-x-auto rounded-xl border border-border @xl:block">
        <table className="w-full min-w-[560px] border-collapse text-[13px]">
          <caption className="sr-only">Dependencies found by discovery</caption>
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="w-16 px-3 py-2 font-medium">
                Use
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Ref
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Kind
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Relation
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Title and why
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const off = removed.has(row.ref);
              const id = `dep-${row.ref}`;
              const why = dependencyWhyText(row.relation, row.why, workflow);
              return (
                <tr key={row.ref} className={cn("border-t border-border align-top", off && "bg-muted/40")}>
                  <td className="px-3 py-2.5">
                    <Checkbox id={id} checked={!off} onCheckedChange={() => onToggle(row.ref)} disabled={disabled} aria-label={`Use ${row.ref}`} />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">
                    <label htmlFor={id} className={cn(off && "line-through decoration-muted-foreground")}>
                      {row.ref}
                    </label>
                  </td>
                  <td className="px-3 py-2.5">
                    <KindIcon kind={row.kind} />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-[11px] whitespace-nowrap text-muted-foreground">{relationText(row.relation)}</span>
                  </td>
                  <td className={cn("px-3 py-2.5", off && "opacity-60")}>
                    <div className="font-medium text-foreground">{row.title}</div>
                    {why ? <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{why}</div> : null}
                    {row.notFetched ? (
                      <div className="mt-1 inline-flex items-center gap-1 text-xs text-status-attention-fg">
                        <AlertTriangle aria-hidden className="size-3.5" />
                        Content not fetched; drafting cannot cite it
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function DependencyReviewForm({ request, run, projectId, onAnswered }: RequestFormProps) {
  const pass = keyNumber(request.key) ?? 1;
  const rows = parseDependencyDetail(request.detail, request.question);
  const doc = /for this (\w+)/.exec(request.question)?.[1] ?? (run?.workflow === "architect-aad" ? "AAD" : "BRD");
  const [decision, setDecision] = useState<DependencyReviewAnswer["decision"] | "">("");
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<string[]>([]);
  const [guidance, setGuidance] = useState("");
  const guidanceId = useId();
  const decisionId = useId();
  const { submit, pending, error, clearError } = useAnswerRequest({ runId: request.runId, requestId: request.id, projectId, onAnswered });

  const answer: DependencyReviewAnswer | Record<string, never> = decision
    ? {
        decision,
        ...(added.length > 0 ? { add: added } : {}),
        ...(removed.size > 0 ? { remove: rows.map((r) => r.ref).filter((r) => removed.has(r)) } : {}),
        ...(decision === "search-more" && guidance.trim() ? { guidance: guidance.trim() } : {}),
      }
    : {};
  const missing = decision ? [] : ["Choose Continue drafting or Search more"];
  // Only fetched content becomes an R-numbered source; a kept row that was not fetched is not used.
  const unfetched = rows.filter((r) => r.notFetched && !removed.has(r.ref)).length;
  const used = rows.length - removed.size - unfetched + added.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-foreground">
          Pass {pass} of up to {MAX_PASSES}
        </span>
        <span>
          {rows.length} found · {used} will be used for the {doc}
          {unfetched ? ` · ${unfetched} could not be fetched` : ""}
        </span>
      </div>

      <DependencyTable
        rows={rows}
        removed={removed}
        disabled={pending}
        workflow={run?.workflow}
        onToggle={(ref) => {
          clearError();
          setRemoved((s) => {
            const next = new Set(s);
            if (next.has(ref)) next.delete(ref);
            else next.add(ref);
            return next;
          });
        }}
      />

      <FormRow label="Add references" hint="Jira keys (CP-51264) or Confluence page ids or URLs. Each is fetched and listed as added during review.">
        <ChipInput
          label="Add references"
          values={added}
          disabled={pending}
          onChange={(v) => {
            clearError();
            setAdded(v);
          }}
          placeholder="CP-51264 or a Confluence page URL"
          addLabel="Add"
          normalize={(raw) => {
            const ref = parseRef(raw);
            if (!ref) return { error: `"${raw}" is not a Jira key (like CP-50908) or a Confluence page id or URL.` };
            if (rows.some((r) => r.ref === ref.value)) return { error: `${ref.value} is already in the list.` };
            return { value: ref.value };
          }}
          renderChip={(v) => (
            <span className="inline-flex items-center gap-1">
              {refKind(v) === "confluence" ? <BookOpen aria-hidden className="size-3" /> : <Ticket aria-hidden className="size-3" />}
              {v}
            </span>
          )}
        />
      </FormRow>

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
            { value: "continue", label: "Continue drafting", icon: SearchCheck },
            { value: "search-more", label: "Search more", icon: SearchIcon },
          ]}
        />
      </FormRow>

      {decision === "search-more" ? (
        <FormRow label="Guidance" htmlFor={guidanceId} hint="What to look for in the next discovery round">
          <Textarea id={guidanceId} rows={3} value={guidance} onChange={(e) => setGuidance(e.target.value)} placeholder="e.g. Find the spike's data-source options" disabled={pending} />
          {pass >= MAX_PASSES ? (
            <Notice className="mt-2">This is the last discovery pass. The workflow will continue to drafting with the list as it stands, including your additions.</Notice>
          ) : null}
        </FormRow>
      ) : null}

      <RequestFooter
        requestId={request.id}
        answer={answer}
        error={error}
        pending={pending}
        missing={missing}
        onSubmit={() => decision && submit(answer)}
        extra={<MonoChip>{rows.length > 0 ? `${removed.size} not used · ${added.length} added` : `${added.length} added`}</MonoChip>}
      />
    </div>
  );
}
