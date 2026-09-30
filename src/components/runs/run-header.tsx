"use client";

/**
 * The run page header (weft RunHeader): the workflow name with Cancel / Resume (with a confirm)
 * on its right, status, id chip, where the run belongs, the "N steps · mm:ss · 46,099 tok · $6.92"
 * facts, a budget meter when the run has a USD limit, and a failure or waiting banner.
 */
import { CircleAlert, OctagonX, Play, RotateCcw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Elapsed, FactCell, FactStrip, IdChip, RelativeTime, StatusPill, StripedBar } from "@/components/common";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useCancelRun, useResumeRun } from "@/lib/api/queries";
import { formatPercent, formatTokens, formatUsd, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TERMINAL_RUN_STATUSES, type HumanState, type RunDetail } from "@/lib/weft/types";
import { pendingHumans } from "./ledger-model";
import { RunContext, WorkflowBadge } from "./run-bits";
import type { RunIndexEntry } from "./run-index-types";

export interface RunHeaderProps {
  run: RunDetail;
  entry?: RunIndexEntry;
  /** Open the Steps tab on a pending request. */
  onOpenRequest?: (h: HumanState) => void;
}

export function RunHeader({ run, entry, onOpenRequest }: RunHeaderProps) {
  const terminal = TERMINAL_RUN_STATUSES.includes(run.status);
  const pending = pendingHumans(run);
  return (
    <header className="flex min-w-0 flex-col gap-5">
      {/* The breadcrumb under the nav leads back to Runs; Cancel / Resume sit in the title row (page-header pattern). */}
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <h1 className="min-w-0 text-[34px] leading-[1.08] font-normal tracking-[-0.03em] break-all text-heading sm:text-[44px] sm:leading-[1.05] sm:tracking-[-0.035em]">{run.workflow}</h1>
          <div className="flex shrink-0 flex-wrap items-center gap-2 empty:hidden">
            <RunActions run={run} projectId={entry?.projectId} />
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusPill status={{ kind: "run", value: run.status }} />
          <WorkflowBadge workflow={run.workflow} />
          <IdChip id={run.runId} />
        </div>
        <RunContext entry={entry} wrap className="text-sm" />
      </div>
      <FactStrip className="card-surface border-0 bg-card">
        <FactCell label="Steps" value={plural(run.steps.length, "step")} />
        <FactCell label={terminal ? "Took" : "Running for"} value={<Elapsed since={run.createdAt} until={terminal ? run.updatedAt : undefined} />} numeric />
        <FactCell label="Tokens" value={formatTokens(run.budget.tokens)} numeric />
        <FactCell label="Spend" value={formatUsd(run.budget.usd)} numeric />
        <FactCell label="Started" value={<RelativeTime at={run.createdAt} />} />
      </FactStrip>
      {run.limits?.usd ? <BudgetMeter used={run.budget.usd} limit={run.limits.usd} kind="usd" /> : null}
      {run.limits?.tokens ? <BudgetMeter used={run.budget.tokens} limit={run.limits.tokens} kind="tokens" /> : null}
      {run.status === "failed" && run.error && (
        <div role="alert" className="card-surface flex min-w-0 items-start gap-3.5 rounded-[20px] px-5 py-4">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-status-danger-bg text-status-danger-fg">
            <OctagonX aria-hidden className="size-[18px]" />
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-[15px] font-medium text-heading">
              Run failed{run.error.step?.label || run.error.step?.key ? <> at <span className="font-mono text-[13px]">{run.error.step.key ?? run.error.step.label}</span></> : null}
              <span className="ml-2 inline-flex h-6 items-center rounded-full bg-status-danger-bg px-2 font-mono text-xs text-status-danger-fg">{run.error.code}</span>
            </p>
            <p className="font-mono text-xs break-words whitespace-pre-wrap text-foreground">{run.error.message}</p>
            <p className="text-[13px] text-muted-foreground">Resume replays the journal and retries from the failed step.</p>
          </div>
        </div>
      )}
      {pending.length > 0 && !terminal && (
        <div className="prompt-band rounded-[22px] p-1.5 md:p-2">
          <p className="flex min-h-9 items-center gap-2 px-2.5 text-[13px] text-foreground/80 md:px-3">
            <CircleAlert aria-hidden className="size-4 shrink-0 text-status-attention-fg" />
            <span className="font-medium text-heading">Needs your input{pending.length > 1 ? ` (${pending.length} requests)` : ""}</span>
            <span className="hidden sm:inline">· the run is paused until someone answers</span>
          </p>
          <div className="prompt-field flex min-h-12 items-center gap-3 p-1.5 pl-4">
            <p className="line-clamp-2 min-w-0 flex-1 text-sm text-heading sm:line-clamp-1">{pending[0]!.question}</p>
            {onOpenRequest && (
              <Button className="shrink-0" onClick={() => onOpenRequest(pending[0]!)}>
                Answer
              </Button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

function BudgetMeter({ used, limit, kind }: { used: number; limit: number; kind: "usd" | "tokens" }) {
  const ratio = limit > 0 ? used / limit : 0;
  const tone = ratio >= 0.9 ? "danger" : ratio >= 0.7 ? "attention" : "running";
  const fmt = (n: number) => (kind === "usd" ? formatUsd(n) : formatTokens(n, { compact: true }));
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:max-w-lg">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] text-muted-foreground">{kind === "usd" ? "Budget" : "Token budget"}</span>
        <span className="text-[15px] text-heading tabular-nums">
          {fmt(used)} <span className="text-muted-foreground">of {fmt(limit)} · {formatPercent(Math.min(ratio, 9.99))}</span>
        </span>
      </div>
      <StripedBar value={Math.min(used, limit)} max={limit} tone={tone} label={`Budget used: ${fmt(used)} of ${fmt(limit)}`} />
    </div>
  );
}

function RunActions({ run, projectId }: { run: RunDetail; projectId?: string }) {
  // `kind` outlives `open` so the dialog keeps its wording while it animates out.
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"cancel" | "resume">("cancel");
  const ask = (k: "cancel" | "resume") => {
    setKind(k);
    setOpen(true);
  };
  const cancel = useCancelRun(projectId);
  const resume = useResumeRun(projectId);
  const canCancel = !TERMINAL_RUN_STATUSES.includes(run.status);
  const canResume = run.status === "failed" || run.status === "cancelled";
  if (!canCancel && !canResume) return null;
  const busy = cancel.isPending || resume.isPending;

  return (
    <>
      {canCancel && (
        <Button variant="secondary" onClick={() => ask("cancel")} disabled={busy}>
          <OctagonX aria-hidden />
          Cancel run
        </Button>
      )}
      {canResume && (
        <Button onClick={() => ask("resume")} disabled={busy}>
          {run.status === "failed" ? <RotateCcw aria-hidden /> : <Play aria-hidden />}
          Resume run
        </Button>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {kind === "cancel" ? "Cancel" : "Resume"} run <span className="font-mono">{run.runId}</span>?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {kind === "cancel" ? (
                <>
                  <span className="font-mono">{run.workflow}</span> stops where it is. Open requests are withdrawn and nothing more is spent. You can resume it later from this page.
                </>
              ) : (
                <>
                  weft replays the journal of <span className="font-mono">{run.workflow}</span> and continues from the last completed step
                  {run.status === "failed" ? ", retrying the step that failed" : ""}. Spend continues against the same budget.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {kind === "cancel" && pendingHumans(run).length > 0 && (
            <p className="flex items-start gap-2 rounded-[14px] bg-status-attention-bg px-3.5 py-2.5 text-[13px] text-status-attention-fg">
              <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {plural(pendingHumans(run).length, "pending request")} will be withdrawn.
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep {kind === "cancel" ? "running" : "as is"}</AlertDialogCancel>
            <AlertDialogAction
              className={cn(kind === "cancel" && "bg-destructive bg-none text-white hover:bg-destructive/90")}
              onClick={() => {
                if (kind === "cancel") cancel.mutate(run.runId);
                else resume.mutate(run.runId);
                setOpen(false);
              }}
            >
              {kind === "cancel" ? "Cancel run" : "Resume run"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
