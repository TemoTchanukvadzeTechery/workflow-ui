"use client";

/**
 * Weft's StepPane: what one step was given, what it produced, and how it went. A pending human
 * request at this position renders as an answerable HumanRequestCard; an answered one shows the
 * question verbatim, who answered, the answer and any edit made to the reviewed file.
 */
import { Check, Copy, CornerDownRight, GitCommitHorizontal, SearchX, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Elapsed, EmptyState, FactCell, FactStrip, Kicker, RelativeTime, StatusPill, Tokens } from "@/components/common";
import { AnswerSummary, HumanRequestCard } from "@/components/hitl";
import { useCopy } from "@/hooks/use-copy";
import { formatDuration, formatTokens, formatUsd } from "@/lib/format";
import { humanKindMeta, riskMeta } from "@/lib/weft/labels";
import { cn } from "@/lib/utils";
import type { HumanState, RunDetail, StepState } from "@/lib/weft/types";
import { DataPane } from "./data-pane";
import { entryKind, entryState, entryTitle, findEntry, stepDurationMs, type LedgerEntry } from "./ledger-model";

export interface StepPaneProps {
  run: RunDetail;
  seq: number;
  /** Passed to HumanRequestCard so answering refreshes the project. */
  projectId?: string;
  /** Called after a request at this position is answered. */
  onAnswered?: () => void;
  className?: string;
}

export function StepPane({ run, seq, projectId, onAnswered, className }: StepPaneProps) {
  const entry = findEntry(run, seq);
  if (!entry) {
    return (
      <div className={className}>
        <EmptyState size="sm" icon={SearchX} title={`No step ${seq} in this run`} body="Pick a step from the list." />
      </div>
    );
  }
  return (
    <div className={cn("@container flex min-w-0 flex-col gap-5", className)}>
      {entry.type === "step" ? <StepBody run={run} entry={entry} step={entry.step} /> : <HumanBody run={run} entry={entry} human={entry.human} projectId={projectId} onAnswered={onAnswered} />}
      <PaneFoot seq={seq} />
    </div>
  );
}

function PaneTitle({ entry, children }: { entry: LedgerEntry; children?: ReactNode }) {
  const st = entryState(entry);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="min-w-0 font-mono text-[17px] leading-6 font-medium tracking-tight break-all text-foreground">
          {entryTitle(entry)}
          <span className="font-sans text-muted-foreground"> · step {entry.seq}</span>
        </h2>
        <StatusPill tone={st.tone} pulse={st.pulse} label={st.label} icon={st.tone === "success" ? Check : st.tone === "danger" ? TriangleAlert : undefined} size="sm" />
        {children}
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline gap-2 border-b pb-1.5">
        <Kicker tone="primary">{title}</Kicker>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function StepBody({ run, entry, step }: { run: RunDetail; entry: LedgerEntry; step: StepState }) {
  const input = run.inputs?.[step.seq];
  const dur = stepDurationMs(step);
  const running = step.status === "running";
  const u = step.usage;
  return (
    <>
      <PaneTitle entry={entry}>
        {step.patchRef && (
          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-status-success-bg px-2 font-mono text-[11px] text-status-success-fg">
            <GitCommitHorizontal aria-hidden className="size-3" /> patch captured
          </span>
        )}
      </PaneTitle>
      {step.label && step.label !== step.key && <p className="-mt-3 font-mono text-xs break-words text-muted-foreground">{step.label}</p>}

      <Section title="Overview">
        <FactStrip className="@3xl:[&>*]:min-w-[104px]">
          <FactCell label="Kind" value={entryKind(entry)} mono />
          {step.route && <FactCell label="Provider" value={step.route.provider} mono />}
          {step.route?.model && <FactCell label="Model" value={step.route.model} mono />}
          {step.route?.effort && <FactCell label="Effort" value={step.route.effort} mono />}
          <FactCell label="Duration" value={running ? <Elapsed since={step.startedAt} /> : formatDuration(dur ?? 0, "clock")} mono />
          {u && <FactCell label="Tokens in / out" value={`${formatTokens(u.input, { unit: false })} / ${formatTokens(u.output, { unit: false })}`} mono hint={u.cacheRead ? `${formatTokens(u.cacheRead, { compact: true })} cache read` : undefined} />}
          {u?.usd !== undefined && <FactCell label="Cost" value={formatUsd(u.usd)} mono />}
          <FactCell label="Phase" value={entry.phase} />
          {step.attempts !== undefined && step.attempts > 1 && <FactCell label="Attempts" value={step.attempts} mono />}
          <FactCell label="Started" value={<RelativeTime at={step.startedAt} />} />
        </FactStrip>
      </Section>

      {step.error && (
        <div role="alert" className="flex min-w-0 flex-col gap-2 rounded-xl border border-status-danger-fg/30 bg-status-danger-bg/60 p-3">
          <div className="flex flex-wrap items-center gap-2 text-status-danger-fg">
            <TriangleAlert aria-hidden className="size-4" />
            <span className="text-sm font-medium">Step failed</span>
            <span className="rounded-md bg-background/70 px-1.5 font-mono text-[11px]">{step.error.code}</span>
            {step.error.attempts ? <span className="text-xs">after {step.error.attempts} attempts</span> : null}
          </div>
          <pre className="font-mono text-xs leading-5 break-words whitespace-pre-wrap text-foreground">{step.error.message}</pre>
          {step.error.detail !== undefined && <DataPane title="error detail" value={step.error.detail} />}
        </div>
      )}

      {step.childRunId && (
        <Link href={`/runs/${step.childRunId}`} className="inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
          <CornerDownRight aria-hidden className="size-3.5" /> Child run <span className="font-mono">{step.childRunId}</span>
        </Link>
      )}

      {input !== undefined && (
        <Section title="Input">
          <DataPane title="step input" note="as scheduled" value={input} />
        </Section>
      )}

      <Section title="Output">
        <DataPane
          title="step output"
          note={running ? "still running" : step.status === "failed" ? "no output (failed)" : u ? <Tokens n={u.input + u.output} className="text-xs" /> : undefined}
          value={step.output}
          emptyText={running ? "The step is still running. Its output appears here when it finishes." : "This step produced no output."}
        />
      </Section>
    </>
  );
}

function HumanBody({ run, entry, human, projectId, onAnswered }: { run: RunDetail; entry: LedgerEntry; human: HumanState; projectId?: string; onAnswered?: () => void }) {
  if (human.status === "pending") {
    return (
      <>
        <PaneTitle entry={entry} />
        <HumanRequestCard runId={run.runId} request={human} workflow={run.workflow} projectId={projectId} onAnswered={onAnswered} />
      </>
    );
  }
  const kind = humanKindMeta(human.kind);
  const policy = human.answeredBy === "policy";
  return (
    <>
      <PaneTitle entry={entry} />
      <Section title="Overview">
        <FactStrip>
          <FactCell label="Kind" value={kind.label} />
          <FactCell label="Request" value={human.id} mono />
          {human.key && <FactCell label="Key" value={human.key} mono />}
          <FactCell label="Phase" value={entry.phase} />
          {human.risk && <FactCell label="Risk" value={riskMeta(human.risk).label} />}
          <FactCell label="Asked" value={<RelativeTime at={human.requestedAt} />} />
          <FactCell label="Answered by" value={human.status === "superseded" ? "superseded" : policy ? "policy (auto-approved)" : (human.answeredBy ?? "-")} />
        </FactStrip>
      </Section>
      <Section title="Question">
        <p className="text-[14px] leading-6 whitespace-pre-wrap text-foreground">{human.question}</p>
        {human.detail && <p className="text-[13px] whitespace-pre-wrap text-muted-foreground">{human.detail}</p>}
      </Section>
      {human.status === "answered" && (
        <Section title="Answer" note={policy ? "tool gates at this risk tier are approved automatically" : undefined}>
          <div className="rounded-xl border bg-card p-3">
            <AnswerSummary answer={human.answer} reviewEdit={human.reviewEdit} />
          </div>
          {human.reviewEdit && (
            <p className="text-xs text-muted-foreground">
              The reviewer edited <span className="font-mono text-foreground">{human.reviewEdit.path}</span> before answering (sha{" "}
              <span className="font-mono">{human.reviewEdit.beforeSha256.slice(0, 8)}</span> to <span className="font-mono">{human.reviewEdit.afterSha256.slice(0, 8)}</span>).
            </p>
          )}
          <DataPane title="answer" note="as posted" value={human.answer} defaultMode="json" />
        </Section>
      )}
      {human.reviewSubject && (
        <Section title="Reviewed">
          <DataPane title={human.reviewSubject.kind === "file" ? human.reviewSubject.path : (human.reviewSubject.label ?? "artifact")} note={human.reviewSubject.kind === "file" ? `${human.reviewSubject.mode} mode` : "artifact"} value={human.reviewSubject.ref} />
        </Section>
      )}
    </>
  );
}

function PaneFoot({ seq }: { seq: number }) {
  const { copied, copy } = useCopy();
  const id = `step:${seq}`;
  return (
    <div className="flex items-center justify-between gap-3 border-t pt-3">
      <span className="truncate font-mono text-xs text-muted-foreground">weft explain {id}</span>
      <button
        type="button"
        onClick={() => void copy(id, "Step id")}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
        {copied ? "Copied" : "Copy step id"}
      </button>
    </div>
  );
}
