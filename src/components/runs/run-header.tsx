"use client";

/**
 * The run page header (weft RunHeader): back link, workflow name, id chip, status, the
 * "N steps · mm:ss · 46,099 tok · $6.92" line, where the run belongs, Cancel / Resume with a
 * confirm, a budget meter when the run has a USD limit, and a failure or waiting banner.
 */
import { ArrowLeft, CircleAlert, OctagonX, Play, RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Elapsed, IdChip, RelativeTime, StatusPill } from "@/components/common";
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
  backHref?: string;
  backLabel?: string;
}

export function RunHeader({ run, entry, onOpenRequest, backHref = "/runs", backLabel = "Runs" }: RunHeaderProps) {
  const terminal = TERMINAL_RUN_STATUSES.includes(run.status);
  const pending = pendingHumans(run);
  return (
    <header className="flex min-w-0 flex-col gap-4">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-full text-muted-foreground">
          <Link href={backHref}>
            <ArrowLeft aria-hidden />
            {backLabel}
          </Link>
        </Button>
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 font-mono text-[26px] leading-8 font-normal tracking-[-0.03em] break-all text-foreground sm:text-[30px] sm:leading-9">{run.workflow}</h1>
            <WorkflowBadge workflow={run.workflow} />
            <IdChip id={run.runId} />
            <StatusPill status={{ kind: "run", value: run.status }} />
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 font-mono text-xs text-muted-foreground tabular-nums">
            <span>{plural(run.steps.length, "step")}</span>
            <span aria-hidden>·</span>
            <Elapsed since={run.createdAt} until={terminal ? run.updatedAt : undefined} className="text-foreground" />
            <span aria-hidden>·</span>
            <span>{formatTokens(run.budget.tokens)}</span>
            <span aria-hidden>·</span>
            <span className="text-foreground">{formatUsd(run.budget.usd)}</span>
            <span aria-hidden>·</span>
            <span className="font-sans">
              started <RelativeTime at={run.createdAt} />
            </span>
          </p>
          <RunContext entry={entry} wrap className="text-[13px]" />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <RunActions run={run} projectId={entry?.projectId} />
        </div>
      </div>
      {run.limits?.usd ? <BudgetMeter used={run.budget.usd} limit={run.limits.usd} kind="usd" /> : null}
      {run.limits?.tokens ? <BudgetMeter used={run.budget.tokens} limit={run.limits.tokens} kind="tokens" /> : null}
      {run.status === "failed" && run.error && (
        <div role="alert" className="flex min-w-0 items-start gap-3 rounded-2xl border border-status-danger-fg/25 bg-status-danger-bg/70 px-4 py-3">
          <OctagonX aria-hidden className="mt-0.5 size-4 shrink-0 text-status-danger-fg" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm font-medium text-status-danger-fg">
              Run failed{run.error.step?.label || run.error.step?.key ? <> at <span className="font-mono">{run.error.step.key ?? run.error.step.label}</span></> : null}
              <span className="ml-2 rounded-md bg-background/70 px-1.5 font-mono text-[11px]">{run.error.code}</span>
            </p>
            <p className="font-mono text-xs break-words whitespace-pre-wrap text-foreground">{run.error.message}</p>
            <p className="text-xs text-muted-foreground">Resume replays the journal and retries from the failed step.</p>
          </div>
        </div>
      )}
      {pending.length > 0 && !terminal && (
        <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-status-attention-fg/25 bg-status-attention-bg/70 px-4 py-3 sm:flex-row sm:items-center">
          <CircleAlert aria-hidden className="hidden size-4 shrink-0 text-status-attention-fg sm:block" />
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="text-sm font-medium text-status-attention-fg">
              Needs your input{pending.length > 1 ? ` (${pending.length} requests)` : ""}: the run is paused until someone answers.
            </p>
            <p className="line-clamp-1 text-[13px] text-foreground">{pending[0]!.question}</p>
          </div>
          {onOpenRequest && (
            <Button size="sm" className="w-fit shrink-0 rounded-full" onClick={() => onOpenRequest(pending[0]!)}>
              Answer
            </Button>
          )}
        </div>
      )}
    </header>
  );
}

function BudgetMeter({ used, limit, kind }: { used: number; limit: number; kind: "usd" | "tokens" }) {
  const ratio = limit > 0 ? used / limit : 0;
  const tone = ratio >= 0.9 ? "bg-status-danger-fg" : ratio >= 0.7 ? "bg-status-attention-fg" : "bg-primary";
  const fmt = (n: number) => (kind === "usd" ? formatUsd(n) : formatTokens(n, { compact: true }));
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:max-w-md">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="kicker">Budget</span>
        <span className="font-mono text-muted-foreground tabular-nums">
          <span className="text-foreground">{fmt(used)}</span> of {fmt(limit)} · {formatPercent(Math.min(ratio, 9.99))}
        </span>
      </div>
      <div
        role="meter"
        aria-label={`Budget used: ${fmt(used)} of ${fmt(limit)}`}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full rounded-full transition-[width] duration-300", tone)} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
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
        <Button variant="outline" className="rounded-full" onClick={() => ask("cancel")} disabled={busy}>
          <OctagonX aria-hidden />
          Cancel run
        </Button>
      )}
      {canResume && (
        <Button className="rounded-full" onClick={() => ask("resume")} disabled={busy}>
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
            <p className="flex items-start gap-2 rounded-lg bg-status-attention-bg px-3 py-2 text-xs text-status-attention-fg">
              <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {plural(pendingHumans(run).length, "pending request")} will be withdrawn.
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Keep {kind === "cancel" ? "running" : "as is"}</AlertDialogCancel>
            <AlertDialogAction
              className={cn("rounded-full", kind === "cancel" && "bg-destructive text-white hover:bg-destructive/90")}
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
