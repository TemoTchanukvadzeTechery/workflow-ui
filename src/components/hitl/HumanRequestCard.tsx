"use client";

/**
 * One weft human request, answerable in place. Accepts a PendingRequest (from a pending list; no
 * key or phase) or a HumanState (from a run), joins key/phase/status from useRun(runId), shows
 * the weft header as a glass strip (mono human.requested · h3, kind and key, risk, a "Waiting 3m"
 * chip; then workflow · runId · phase; below a 420px container, as in the rail, one line of
 * workflow · runId and the Waiting chip, with the rest in the form's "Show answer JSON"
 * disclosure via RequestMetaContext), the question verbatim as the card title, and the bespoke form for its key, else the generic SchemaForm. Answered and
 * superseded requests collapse to a read-only summary.
 */
import { Ban, CheckCircle2, Hourglass } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useRun } from "@/lib/api/queries";
import type { HumanState, PendingRequest, Risk } from "@/lib/weft/types";
import type { PlannedTask } from "@/lib/weft/workflows";
import { cn } from "@/lib/utils";
import { FloatingChip } from "@/components/common";
import { MonoChip, TimeAgo, TonePill, type Tone } from "./bits";
import { GenericRequestForm, pickRequestForm } from "./forms";
import { RequestMetaContext, type RequestMeta } from "./RequestFooter";
import { toRequestView, type RequestView } from "./types";

export interface HumanRequestCardProps {
  runId: string;
  request: PendingRequest | HumanState;
  projectId?: string;
  /** Workflow name when the caller knows it (PendingEntry.workflow); else read from the run. */
  workflow?: string;
  /** Rail placement: tighter padding, documents collapsed until opened. */
  compact?: boolean;
  onAnswered?: () => void;
  /** Scroll into view and highlight (?request=<runId>:<hId>). */
  focused?: boolean;
  /** plan:review: tasks edited in a PlanEditor, sent as `tasks`. */
  editedTasks?: PlannedTask[];
  /** memory:review: stale register entries to warn about. */
  memoryStale?: string[];
  /** Display name for answeredBy "human" in the summary, when the caller knows it. */
  answeredByName?: string;
  /** Inside a card that already frames it (the inbox detail): no surface, edge or radius of its own. */
  bare?: boolean;
  className?: string;
}

const RISK_TONE: Record<Risk, Tone> = { low: "neutral", medium: "attention", high: "danger", irreversible: "danger" };

/** DOM id of a request card, for ?request= focusing and in-page links. */
export function requestDomId(runId: string, requestId: string): string {
  return `request-${runId}-${requestId}`;
}

function CardHeader({ view, compact }: { view: RequestView; compact?: boolean }) {
  const pending = view.status === "pending";
  const waiting = pending ? <FloatingChip size="sm" tone="attention" icon={Hourglass} value={<TimeAgo at={view.createdAt} prefix="Waiting " elapsed />} title="Holds the run until answered" /> : null;
  // Narrow cards still show a risk that asks for care; "low" moves to the answer JSON disclosure.
  const loudRisk = view.risk && view.risk !== "low";
  return (
    <div className={cn("glass flex flex-col gap-1.5", compact ? "m-1.5 rounded-[15px] px-3 py-2" : "m-2 rounded-[20px] px-3.5 py-2.5 @2xl:px-4")}>
      {/* Wide (420px and up): the weft event, kind, key and risk, with the Waiting chip. */}
      <div className="hidden flex-wrap items-center gap-x-2 gap-y-1.5 @min-[420px]:flex">
        <span className="font-mono text-[11.5px] text-muted-foreground">human.requested · {view.id}</span>
        <MonoChip>{view.kind}</MonoChip>
        {view.key ? <MonoChip className="hidden @md:inline-flex">{view.key}</MonoChip> : null}
        {view.risk ? <TonePill tone={RISK_TONE[view.risk]} className="h-6 gap-1 px-2 text-xs">risk: {view.risk}</TonePill> : null}
        <span className="flex-1" />
        {waiting}
      </div>
      {/* workflow · run (· phase when wide); narrow, this one line also carries the Waiting chip. */}
      <div className={cn("flex min-w-0 items-center gap-x-1.5 font-mono text-heading @min-[420px]:flex-wrap", compact ? "text-[11.5px]" : "text-xs")}>
        <span className="truncate">{view.workflow ?? "run"}</span>
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
        <Link href={`/runs/${view.runId}`} className="shrink-0 text-primary underline-offset-2 hover:underline focus-visible:rounded focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          {view.runId}
        </Link>
        {view.phase ? (
          <span className="hidden items-center gap-x-1.5 @min-[420px]:inline-flex">
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            <span>{view.phase}</span>
          </span>
        ) : null}
        {pending ? <span className="ml-auto hidden font-sans text-xs text-muted-foreground @min-[420px]:inline">Holds the run until answered</span> : null}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 font-sans @min-[420px]:hidden">
          {loudRisk && view.risk ? <TonePill tone={RISK_TONE[view.risk]} className="h-6 gap-1 px-2 text-xs">risk: {view.risk}</TonePill> : null}
          {waiting}
        </span>
      </div>
    </div>
  );
}

function summarize(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "[]" : value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ");
  if (typeof value === "string") return value.length > 140 ? `${value.slice(0, 140)}…` : value;
  return JSON.stringify(value);
}

/** Read-only answer: each field, plus the file edit when there was one. */
export function AnswerSummary({ answer, reviewEdit }: { answer: unknown; reviewEdit?: RequestView["reviewEdit"] }) {
  const entries = answer && typeof answer === "object" && !Array.isArray(answer) ? Object.entries(answer as Record<string, unknown>) : [];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-[14px] bg-well/60 px-3.5 py-3 text-[13px]">
      {entries.length === 0 ? (
        <>
          <dt className="text-muted-foreground">answer</dt>
          <dd className="font-mono text-xs">{summarize(answer)}</dd>
        </>
      ) : (
        entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
            <dd className={cn("min-w-0 break-words", typeof v === "string" && v.length < 40 ? "font-mono text-xs" : "")}>{summarize(v)}</dd>
          </div>
        ))
      )}
      {reviewEdit ? (
        <>
          <dt className="font-mono text-xs text-muted-foreground">reviewEdit</dt>
          <dd className="font-mono text-xs">edited {reviewEdit.path}</dd>
        </>
      ) : null}
    </dl>
  );
}

function ClosedSummary({ view, answeredByName }: { view: RequestView; answeredByName?: string }) {
  const superseded = view.status === "superseded";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {superseded ? (
          <TonePill tone="neutral" icon={Ban}>
            Superseded
          </TonePill>
        ) : (
          <TonePill tone="success" icon={CheckCircle2}>
            Answered{view.answeredBy ? ` by ${view.answeredBy === "human" && answeredByName ? answeredByName : view.answeredBy}` : ""}
          </TonePill>
        )}
      </div>
      <p className="line-clamp-3 text-sm whitespace-pre-wrap text-muted-foreground">{view.question}</p>
      {!superseded && view.answer !== undefined ? <AnswerSummary answer={view.answer} reviewEdit={view.reviewEdit} /> : null}
    </div>
  );
}

export function HumanRequestCard({ runId, request, projectId, workflow, compact, onAnswered, focused, editedTasks, memoryStale, answeredByName, bare, className }: HumanRequestCardProps) {
  const run = useRun(runId);
  const view = toRequestView(runId, request, run.data, workflow);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focused]);

  // Bespoke forms are picked by key; PendingRequest has none until the run loads.
  const waitingForKey = view.key === undefined && run.isPending;
  const picked = pickRequestForm(view);
  const Form = picked?.Component;
  const closed = view.status !== "pending";
  const meta = useMemo<RequestMeta>(() => ({ id: view.id, kind: view.kind, key: view.key, phase: view.phase, risk: view.risk }), [view.id, view.kind, view.key, view.phase, view.risk]);

  return (
    <article
      ref={ref}
      id={requestDomId(runId, view.id)}
      aria-label={`Request ${view.id} on run ${runId}`}
      data-form={picked?.name ?? "schema"}
      className={cn(
        "@container min-w-0 scroll-mt-20",
        !bare && "card-surface",
        !bare && (compact ? "rounded-[20px]" : "rounded-2xl"),
        focused && "ring-2 ring-ring",
        className,
      )}
    >
      <CardHeader view={view} compact={compact} />
      <RequestMetaContext.Provider value={meta}>
      <div className={cn("min-w-0", compact ? "space-y-3 px-3.5 pt-2 pb-3.5" : "space-y-5 px-5 pt-3 pb-5 @2xl:px-6 @2xl:pb-6")}>
      {closed ? (
        <ClosedSummary view={view} answeredByName={answeredByName} />
      ) : (
        <>
          <h3 className={cn("font-medium tracking-[-0.01em] whitespace-pre-wrap text-heading", compact ? "text-[15px] leading-6" : "text-[18px] leading-7 @2xl:text-[20px]")}>{view.question}</h3>
          {waitingForKey ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : Form ? (
            <Form key={`${runId}:${view.id}`} request={view} run={run.data} projectId={projectId} compact={compact} onAnswered={onAnswered} editedTasks={editedTasks} stale={memoryStale} />
          ) : (
            <GenericRequestForm key={`${runId}:${view.id}`} request={view} run={run.data} projectId={projectId} compact={compact} onAnswered={onAnswered} />
          )}
        </>
      )}
      </div>
      </RequestMetaContext.Provider>
    </article>
  );
}
