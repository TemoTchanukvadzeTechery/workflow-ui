"use client";

/**
 * QA sub-step "Tasks": the Ready for test hand-off, then start qa-verify for every eligible task
 * or a selection (a selection can re-test certified or blocked tasks, e.g. after a send-back from
 * PO Review), then follow each task's QA: AC met x/y, automated pass/fail/skip, manual evidence,
 * QA status, the live step while the agent runs, and Review when its qa:review is waiting. A
 * task QA rejects loops back to implementation (SPEC 1, decision 3); its card shows the bugs and
 * the rework, with the developer's review, until QA re-tests.
 */
import { ArrowRight, Bug, ExternalLink, FileSearch, FlaskConical, Play, RefreshCw, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, HatchedBar, RelativeTime, SectionCard, StatusDot, StatusPill, actorText } from "@/components/common";
import { automatedCounts, liveEvidence } from "@/components/evidence/utils";
import { RunChip } from "@/components/stage";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useStartQa } from "@/lib/api/queries";
import type { DeliveryTask, ProjectBundle, QaStep } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { qaStatusMeta, taskStatusMeta, type StatusMeta } from "@/lib/weft/labels";
import { ReadyForTestCard } from "./ReadyForTestCard";
import { activeTasks, canRetest, canRunQa, isLoopedBack, isQaEligible, isRetesting, pendingDevReview, pendingQaReview, qaBlockedReason, taskHref, taskKey } from "./shared";

interface Props {
  projectId: string;
  bundle: ProjectBundle;
  readOnly: boolean;
  onReview: (taskId: string) => void;
  /** Once every task is certified: the next QA sub-step with work left, and how to go there. */
  next?: { step: QaStep; label: string };
  onGo?: (step: QaStep) => void;
}

function qaPill(t: DeliveryTask): StatusMeta {
  const meta = qaStatusMeta(t.qa.status);
  if (isRetesting(t) && t.qa.status === "testing") return { ...meta, label: "Re-testing" };
  return meta;
}

function Stat({ label, value, tone, className }: { label: string; value: string | number; tone?: "success" | "review" | "running" | "danger" | "attention" | "neutral"; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-xl bg-muted/60 px-3 py-2.5", className)}>
      <span className="kicker">{label}</span>
      <span className="flex items-center gap-2 text-2xl leading-none tabular-nums">
        {tone ? <StatusDot tone={tone === "neutral" ? "neutral" : tone} size="md" /> : null}
        {value}
      </span>
    </div>
  );
}

function AutomatedCell({ task, bundle }: { task: DeliveryTask; bundle: ProjectBundle }) {
  const live = liveEvidence(bundle.evidence, task.id);
  const c = automatedCounts(live);
  if (c.items === 0) return <span className="text-xs text-muted-foreground">No runs yet</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 text-xs tabular-nums" aria-label={`Automated: ${c.passed} passed, ${c.failed} failed, ${c.skipped} skipped`}>
      <span className="text-status-success-fg">{c.passed} pass</span>
      <span className={c.failed ? "font-medium text-status-danger-fg" : "text-muted-foreground"}>{c.failed} fail</span>
      <span className="text-muted-foreground">{c.skipped} skip</span>
    </span>
  );
}

function LiveStep({ task, bundle, readOnly }: { task: DeliveryTask; bundle: ProjectBundle; readOnly: boolean }) {
  if (task.qa.status === "testing") {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-foreground">
        <StatusDot tone="running" pulse size="sm" />
        <span className="truncate">{task.latestStep ?? "qa-verify is running"}</span>
      </span>
    );
  }
  if (task.qa.status === "in_review") return <span className="text-xs text-status-review-fg">Awaiting QA review</span>;
  if (task.qa.status === "bugs_found") {
    return (
      <span className="line-clamp-2 text-xs text-status-danger-fg" title={task.latestStep}>
        {task.status === "done" ? "Rework done, re-test next" : `Back in implementation${task.latestStep ? ` · ${task.latestStep}` : ""}`}
      </span>
    );
  }
  if (task.qa.status === "blocked") {
    const reason = qaBlockedReason(bundle, task);
    return (
      <span className="flex min-w-0 flex-col gap-0.5 text-xs">
        <span className="line-clamp-2 text-status-attention-fg" title={reason?.text}>
          Blocked: {reason?.text}
        </span>
        <span className="text-muted-foreground">
          {reason?.review ? (
            <>
              {actorText(reason.review.by)} <RelativeTime at={reason.review.at} />
            </>
          ) : null}
          {reason?.review && !readOnly ? " · " : null}
          {!readOnly ? "re-test once resolved" : null}
        </span>
      </span>
    );
  }
  if (task.qa.status === "certified" && task.qa.review) {
    return (
      <span className="truncate text-xs text-muted-foreground">
        by {actorText(task.qa.review.by)} <RelativeTime at={task.qa.review.at} />
      </span>
    );
  }
  if (task.status !== "done") return <span className="text-xs text-muted-foreground">Waiting on implementation</span>;
  return <span className="text-xs text-muted-foreground">Not started</span>;
}

interface RowActionProps {
  task: DeliveryTask;
  bundle: ProjectBundle;
  readOnly: boolean;
  onReview: (id: string) => void;
  onRetest: (id: string) => void;
  /** The task a Re-test is starting for, or "" while a Run QA is starting. */
  starting: string | null;
  /** QA was reopened (send-back or stale): offer Re-test on certified rows too, not only blocked ones. */
  reopened: boolean;
}

function ReviewAction({ task, bundle, readOnly, onReview, onRetest, starting, reopened }: RowActionProps) {
  const pending = pendingQaReview(bundle, task);
  const hasEvidence = bundle.evidence.some((e) => e.taskId === task.id);
  const retest = !readOnly && canRetest(task) && (reopened || task.qa.status !== "certified");
  const main =
    pending && !readOnly ? (
      <Button type="button" size="sm" className="h-7 rounded-full px-3" onClick={() => onReview(task.id)} aria-label={`Review ${taskKey(task)}`}>
        Review
      </Button>
    ) : hasEvidence ? (
      <Button type="button" variant="ghost" size="sm" className="h-7 rounded-full px-2.5" onClick={() => onReview(task.id)} aria-label={`Evidence for ${taskKey(task)}`}>
        <FileSearch aria-hidden />
        Evidence
      </Button>
    ) : null;
  if (!main && !retest) return null;
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {main}
      {retest ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 rounded-full px-2.5"
          onClick={() => onRetest(task.id)}
          disabled={starting !== null}
          aria-label={`Re-test ${taskKey(task)}`}
          title="Start a new qa-verify run on this task. Its evidence supersedes the last run's, and QA reviews it again."
        >
          <RefreshCw aria-hidden className={cn(starting === task.id && "animate-spin motion-reduce:animate-none")} />
          {starting === task.id ? "Starting…" : "Re-test"}
        </Button>
      ) : null}
    </div>
  );
}

function LoopBackCard({ projectId, bundle, task }: { projectId: string; bundle: ProjectBundle; task: DeliveryTask }) {
  const dev = pendingDevReview(bundle, task);
  const lastRun = task.runIds[task.runIds.length - 1];
  const runStatus = bundle.stages.qa.runs.find((r) => r.runId === lastRun)?.status ?? bundle.stages.implementation.runs.find((r) => r.runId === lastRun)?.status;
  const tMeta = taskStatusMeta(task.status);
  return (
    <li className="rounded-xl border border-status-danger-fg/25 bg-card p-3.5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-status-danger-bg text-status-danger-fg">
          <RotateCcw aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-[1_1_16rem] space-y-0.5">
          <p className="text-[13px] font-medium">Back in implementation · rework from QA</p>
          <p className="text-[13px] text-muted-foreground">
            <Link href={taskHref(projectId, task.id)} className="font-mono text-xs text-primary hover:underline">
              {taskKey(task)}
            </Link>{" "}
            {task.title}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill {...tMeta} size="sm" label={`Dev: ${tMeta.label}`} />
          {lastRun ? <RunChip runId={lastRun} workflow="dev-task" status={runStatus} /> : null}
          {dev ? (
            <Button asChild size="sm" className="h-7 rounded-full px-3">
              <Link href={taskHref(projectId, task.id, dev)} aria-label={`Review the rework of ${taskKey(task)}`}>
                Review rework
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-3 grid gap-3 @2xl/qa:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className="space-y-1.5">
          <h4 className="kicker">Bugs QA reported</h4>
          <ol className="space-y-1">
            {task.qa.bugs.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px]">
                <Bug aria-hidden className="mt-0.5 size-3.5 shrink-0 text-status-danger-fg" />
                <span>{b}</span>
              </li>
            ))}
            {task.qa.bugs.length === 0 ? <li className="text-[13px] text-muted-foreground">No bug text recorded.</li> : null}
          </ol>
          {task.qa.review ? (
            <p className="text-xs text-muted-foreground">
              Reported by {actorText(task.qa.review.by)} <RelativeTime at={task.qa.review.at} />
              {task.qa.review.comment ? <>: &ldquo;{task.qa.review.comment}&rdquo;</> : null}
            </p>
          ) : null}
        </div>
        <div className="space-y-2 rounded-lg bg-muted/60 px-3 py-2.5">
          <h4 className="kicker">Rework</h4>
          <p className="flex items-center gap-1.5 text-[13px]">
            {task.status === "in_progress" || task.status === "verifying" ? <StatusDot tone="running" pulse size="sm" /> : null}
            <span>{task.latestStep ?? tMeta.label}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Attempt {task.runIds.length} · rework {task.reworkCount} of 2{task.escalated ? " · escalated" : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {dev ? "The fix is waiting for its developer review (anyone can give it): Review rework opens it on the task page. " : ""}
            QA re-tests automatically once the fix is approved. The project stays in QA.
          </p>
        </div>
      </div>
    </li>
  );
}

function TaskCell({ projectId, task }: { projectId: string; task: DeliveryTask }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-1.5">
        <Link href={taskHref(projectId, task.id)} className="font-mono text-xs font-medium text-primary underline-offset-2 hover:underline">
          {taskKey(task)}
        </Link>
        <span className="font-mono text-[11px] text-muted-foreground">{task.id}</span>
      </div>
      <Link href={taskHref(projectId, task.id)} className="line-clamp-2 text-[13px] leading-snug text-foreground hover:underline">
        {task.title}
      </Link>
    </div>
  );
}

export function TasksPanel({ projectId, bundle, readOnly, onReview, next, onGo }: Props) {
  const tasks = activeTasks(bundle);
  const startQa = useStartQa(projectId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Which Re-test is starting ("" = the header's Run QA), so only that button says "Starting…".
  const [starting, setStarting] = useState<string | null>(null);
  const eligible = tasks.filter(isQaEligible);
  // Any done task without a run in progress can be selected: pending ones for a first run,
  // certified or blocked ones for a re-test.
  const selectable = tasks.filter(canRunQa);
  const sel = [...selected].filter((id) => selectable.some((t) => t.id === id));
  const selRetests = sel.filter((id) => selectable.some((t) => t.id === id && canRetest(t))).length;
  const loopedBack = tasks.filter(isLoopedBack);
  const count = (s: DeliveryTask["qa"]["status"]) => tasks.filter((t) => t.qa.status === s).length;
  const pendingReviews = tasks.filter((t) => pendingQaReview(bundle, t)).length;
  const certified = count("certified");
  const busy = startQa.isPending || starting !== null;
  // Sent back from PO Review, reopened, or stale: certified work may need a re-test, so every
  // certified row offers Re-test (otherwise only blocked rows do; any row can still be ticked).
  const qaRecord = bundle.project.stages.qa;
  const reopened = (qaRecord.reopened?.length ?? 0) > 0 || !!qaRecord.stale;

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const start = (taskIds: string[] | undefined, key: string) => {
    setStarting(key);
    startQa.mutate(taskIds ? { taskIds } : {}, {
      onSuccess: () => setSelected((s) => new Set([...s].filter((id) => !taskIds || !taskIds.includes(id)))),
      onSettled: () => setStarting(null),
    });
  };
  const run = () => start(sel.length ? sel : undefined, "");
  const retest = (id: string) => start([id], id);
  const checkboxLabel = (t: DeliveryTask) =>
    canRetest(t) ? `Select ${taskKey(t)} for a re-test` : canRunQa(t) ? `Select ${taskKey(t)} for QA` : t.status !== "done" ? `${taskKey(t)} is still in implementation` : `${taskKey(t)} is being tested`;
  const hint =
    sel.length > 0
      ? `${sel.length} selected${selRetests ? ` (${selRetests} ${selRetests === 1 ? "re-test" : "re-tests"}: new evidence supersedes the last run's, and QA reviews again)` : ""}.`
      : eligible.length > 0
        ? `${eligible.length} ${eligible.length === 1 ? "task is" : "tasks are"} ready for QA. Run all, or tick tasks below to run a selection.`
        : selectable.length > 0
          ? `No task is waiting for a first QA run. To re-test a certified or blocked task, ${reopened ? "use Re-test on its row, or tick several below and run QA" : "tick it below and run QA, or open its Evidence and choose Re-test"}. Tasks QA rejects are re-tested automatically after rework.`
          : "No task can start a QA run now: each one is being tested, waiting for review, or back in implementation.";

  if (tasks.length === 0) {
    return <EmptyState icon={FlaskConical} title="No tasks to test" body="Tasks come from the approved implementation plan. Once developers approve them, QA runs here." />;
  }

  return (
    <div className="@container/qa space-y-4">
      <ReadyForTestCard projectId={projectId} bundle={bundle} />
      <SectionCard
        density="dense"
        kicker="qa-verify · one run per task"
        title="QA agents"
        description="Each run writes a test plan, runs unit, API and e2e checks, records a manual browser session, and asks QA to certify."
        actions={
          !readOnly ? (
            <Button type="button" className="rounded-full" onClick={run} disabled={(eligible.length === 0 && sel.length === 0) || busy}>
              <Play aria-hidden />
              {starting === "" ? "Starting…" : sel.length ? `Run QA on ${sel.length} selected` : "Run QA agents"}
            </Button>
          ) : null
        }
      >
        <div className="grid grid-cols-2 gap-2 @2xl/qa:grid-cols-5">
          <Stat label="Certified" value={`${certified}/${tasks.length}`} tone="success" className="col-span-2 @2xl/qa:col-span-1" />
          <Stat label="Awaiting review" value={pendingReviews} tone="review" />
          <Stat label="Testing" value={count("testing")} tone="running" />
          <Stat label="Bugs found" value={count("bugs_found")} tone="danger" />
          <Stat label="Blocked" value={count("blocked")} tone="attention" />
        </div>
        {!readOnly ? <p className="mt-3 text-xs text-muted-foreground">{hint}</p> : null}
        {!readOnly && next && onGo && certified === tasks.length ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-status-success-bg px-3 py-2 text-[13px] text-status-success-fg" role="status">
            <span className="font-medium">All tasks certified: next, {next.label}.</span>
            <Button type="button" variant="outline" size="sm" className="h-7 rounded-full bg-card" onClick={() => onGo(next.step)}>
              Go to {next.label}
              <ArrowRight aria-hidden />
            </Button>
          </div>
        ) : null}
      </SectionCard>

      {loopedBack.length > 0 ? (
        <section aria-label="Tasks back in implementation" className="space-y-2">
          <h3 className="kicker px-1">Loop-back to implementation</h3>
          <ul className="space-y-2">
            {loopedBack.map((t) => (
              <LoopBackCard key={t.id} projectId={projectId} bundle={bundle} task={t} />
            ))}
          </ul>
        </section>
      ) : null}

      <SectionCard density="dense" title="Tasks" description={`${tasks.length} tasks · QA status per task`} flush>
        {/* Wide: a table. Narrow: one card per task. */}
        <div className="hidden @2xl/qa:block">
          <table className="w-full table-fixed text-[13px]">
            <caption className="sr-only">QA status per task</caption>
            <thead>
              <tr className="border-y bg-muted/40 text-left text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
                <th scope="col" className="py-2 pr-3 pl-4">Task</th>
                <th scope="col" className="w-[76px] py-2 pr-3">AC met</th>
                <th scope="col" className="w-[112px] py-2 pr-3">Automated</th>
                <th scope="col" className="w-[62px] py-2 pr-3 text-right">Manual</th>
                <th scope="col" className="w-[160px] py-2 pr-3 pl-2">QA status</th>
                <th scope="col" className="w-[92px] py-2 pr-4 text-right">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tasks.map((t) => {
                const ok = canRunQa(t);
                const met = t.acceptanceCriteria.filter((a) => a.met).length;
                const manual = liveEvidence(bundle.evidence, t.id).filter((e) => e.mode === "manual").length;
                return (
                  <tr key={t.id} className={cn("align-top", pendingQaReview(bundle, t) && "bg-status-review-bg/30")}>
                    <td className="py-2.5 pr-3 pl-4">
                      <div className="flex items-start gap-2.5">
                        {!readOnly ? <Checkbox checked={ok && selected.has(t.id)} disabled={!ok} onCheckedChange={(c) => toggle(t.id, c === true)} aria-label={checkboxLabel(t)} className="mt-0.5" /> : null}
                        <div className="min-w-0 flex-1">
                          <TaskCell projectId={projectId} task={t} />
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="space-y-1">
                        <span className="text-xs tabular-nums">
                          {met}/{t.acceptanceCriteria.length}
                        </span>
                        <HatchedBar done={met} total={t.acceptanceCriteria.length} size="sm" label={`${met} of ${t.acceptanceCriteria.length} acceptance criteria met`} />
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <AutomatedCell task={t} bundle={bundle} />
                    </td>
                    <td className="py-2.5 pr-3 text-right text-xs tabular-nums">{manual}</td>
                    <td className="py-2.5 pr-3 pl-2">
                      <div className="flex min-w-0 flex-col items-start gap-1">
                        <StatusPill {...qaPill(t)} size="sm" />
                        <LiveStep task={t} bundle={bundle} readOnly={readOnly} />
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-right">
                      <ReviewAction task={t} bundle={bundle} readOnly={readOnly} onReview={onReview} onRetest={retest} starting={starting} reopened={reopened} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="divide-y border-t @2xl/qa:hidden">
          {tasks.map((t) => {
            const ok = canRunQa(t);
            const met = t.acceptanceCriteria.filter((a) => a.met).length;
            const manual = liveEvidence(bundle.evidence, t.id).filter((e) => e.mode === "manual").length;
            return (
              <li key={t.id} className="space-y-2 px-4 py-3">
                <div className="flex items-start gap-2.5">
                  {!readOnly ? <Checkbox checked={ok && selected.has(t.id)} disabled={!ok} onCheckedChange={(c) => toggle(t.id, c === true)} aria-label={checkboxLabel(t)} className="mt-1" /> : null}
                  <div className="min-w-0 flex-1">
                    <TaskCell projectId={projectId} task={t} />
                  </div>
                  <ReviewAction task={t} bundle={bundle} readOnly={readOnly} onReview={onReview} onRetest={retest} starting={starting} reopened={reopened} />
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                  <StatusPill {...qaPill(t)} size="sm" />
                  <span className="tabular-nums">
                    AC {met}/{t.acceptanceCriteria.length}
                  </span>
                  <AutomatedCell task={t} bundle={bundle} />
                  <span className="text-muted-foreground tabular-nums">{manual} manual</span>
                </div>
                <LiveStep task={t} bundle={bundle} readOnly={readOnly} />
              </li>
            );
          })}
        </ul>
        <p className="flex items-center gap-1.5 border-t px-4 py-2.5 text-xs text-muted-foreground">
          <ExternalLink aria-hidden className="size-3.5" />
          Each task page has the full ledger, diffs and the same review.
        </p>
      </SectionCard>
    </div>
  );
}
