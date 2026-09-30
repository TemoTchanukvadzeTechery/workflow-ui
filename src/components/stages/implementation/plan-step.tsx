"use client";

/**
 * The Plan sub-step (brief C.3): what the planner reads, the developer notes (written in the rail's
 * Notes panel, anchored to AAD sections, summarised here), the read-only system -> repo map and
 * "Generate tasks". While dev-plan runs, its live
 * status; when it asks plan:review:<round>, the PlanEditor and the decision; once approved, the
 * approved plan by wave with the planner's report.
 */
import { ArrowRight, ArrowUpRight, CheckCircle2, Sparkles, StickyNote } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { CircleIconButton, ErrorState, RelativeTime, SectionCard, SegmentedControl, StatusPill, actorText } from "@/components/common";
import { START_MODE_LABELS } from "@/components/hitl";
import { anchorLabel } from "@/components/stage";
import { DepChips, RepoChip, ScopedTitle, SizeChip, TaskIdLabel, TraceChips, taskHref } from "@/components/tasks";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useRun, useStartPlan } from "@/lib/api/queries";
import type { DeliveryTask, ProjectBundle } from "@/lib/delivery/types";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TERMINAL_RUN_STATUSES, type HumanState, type RunDetail } from "@/lib/weft/types";
import type { DevPlanOutput, PlanReport } from "@/lib/weft/workflows";
import { docHref, docOf, PlanInputs, SystemRepoMap } from "./inputs";
import { PlanReview } from "./plan-review";
import { PlanRunStatus } from "./plan-run-status";
import { RAISED_ROW, WaveLane } from "./lanes";

export function pendingPlanRequest(run: RunDetail | undefined): HumanState | undefined {
  return run?.humans.find((h) => h.status === "pending" && h.key?.startsWith("plan:review:"));
}

export interface PlanStepProps {
  projectId: string;
  bundle: ProjectBundle;
  readOnly: boolean;
  /** "<runId>:<hId>" from ?request=. */
  focusRequest?: string;
  onOpenExecution: () => void;
}

export function PlanStep({ projectId, bundle, readOnly, focusRequest, onOpenExecution }: PlanStepProps) {
  const record = bundle.project.stages.implementation;
  const latest = record.planRunIds.at(-1);
  const runQ = useRun(latest);
  const run = runQ.data;
  const approved = !!record.planApprovedAt;
  const pending = pendingPlanRequest(run);
  const live = run && !TERMINAL_RUN_STATUSES.includes(run.status);
  const docLabels = Object.fromEntries(bundle.documents.map((d) => [d.id, d.kind.toUpperCase()]));

  if (latest && runQ.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="card-surface space-y-3 rounded-2xl p-5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-8 w-full" />
        </div>
        <div className="card-surface space-y-2 rounded-2xl p-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (latest && runQ.error) return <ErrorState title="Could not load the dev-plan run" error={runQ.error} onRetry={() => void runQ.refetch()} className="card-surface rounded-2xl" />;

  if (approved) {
    return (
      <div className="space-y-4">
        <ApprovedPlan projectId={projectId} bundle={bundle} run={run} onOpenExecution={onOpenExecution} />
        <PlanInputs projectId={projectId} bundle={bundle} compact />
        <SystemRepoMap bundle={bundle} />
      </div>
    );
  }

  if (pending && latest) {
    return (
      <div className="space-y-4">
        <PlanRunStatus runId={latest} />
        <PlanReview projectId={projectId} bundle={bundle} runId={latest} request={pending} focused={focusRequest === `${latest}:${pending.id}`} />
        <PlanInputs projectId={projectId} bundle={bundle} compact />
      </div>
    );
  }

  if (live && latest) {
    return (
      <div className="space-y-4">
        <PlanRunStatus runId={latest} />
        <PlanInputs projectId={projectId} bundle={bundle} compact />
        <SystemRepoMap bundle={bundle} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GenerateCard projectId={projectId} bundle={bundle} readOnly={readOnly} lastRun={run} docLabels={docLabels} />
      <PlanInputs projectId={projectId} bundle={bundle} />
      <SystemRepoMap bundle={bundle} />
    </div>
  );
}

function GenerateCard({ projectId, bundle, readOnly, lastRun, docLabels }: { projectId: string; bundle: ProjectBundle; readOnly: boolean; lastRun?: RunDetail; docLabels: Record<string, string> }) {
  const start = useStartPlan(projectId);
  const brd = docOf(bundle, "brd");
  const aad = docOf(bundle, "aad");
  const missing = [brd?.status === "accepted" ? null : "an accepted BRD", aad?.status === "accepted" ? null : "an accepted AAD"].filter(Boolean);
  const allNotes = bundle.project.stages.implementation.notes;
  const notes = allNotes.filter((n) => !n.sentToRunId).length;
  const epics = bundle.epics.filter((e) => e.status !== "draft").length;
  const failed = lastRun && (lastRun.status === "failed" || lastRun.status === "cancelled");

  return (
    <section aria-label="Generate tasks" className="card-surface relative overflow-hidden rounded-2xl p-5 @container sm:p-6">
      <div className="flex flex-col gap-4 @2xl:flex-row @2xl:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-status-running-bg text-status-running-fg">
            <Sparkles aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <p className="text-[13px] text-muted-foreground">Next step</p>
            <h2 className="text-[20px] leading-7 font-medium tracking-[-0.015em] text-heading">{failed ? "Generate the plan again" : "Generate tasks from the BRD and AAD"}</h2>
            <p className="text-sm leading-5 text-muted-foreground">
              A dev-plan run reads the accepted documents, shared memory, {plural(epics, "accepted epic")} and {notes ? plural(notes, "new developer note") : "your developer notes"}, then proposes tasks in waves (Context → Plan 1). Nothing starts until you approve the plan.
            </p>
            {failed ? (
              <p className="text-[13px] text-status-danger-fg">
                The last run ({lastRun.runId}) {lastRun.status === "failed" ? `failed${lastRun.error?.message ? `: ${lastRun.error.message}` : ""}` : "was cancelled"}.
              </p>
            ) : null}
            {missing.length ? <p className="text-[13px] text-status-attention-fg">Needs {missing.join(" and ")} first.</p> : null}
          </div>
        </div>
        {!readOnly ? (
          <Button className="shrink-0 self-start @2xl:self-center" size="lg" disabled={missing.length > 0 || start.isPending} onClick={() => start.mutate({})}>
            {start.isPending ? <Spinner aria-hidden /> : <Sparkles aria-hidden />}
            Generate tasks
          </Button>
        ) : null}
      </div>
      <div className="mt-5 space-y-2.5 border-t border-rule pt-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h3 className="text-[15px] font-medium text-heading">Developer notes</h3>
          <span className="text-[13px] text-muted-foreground">Write them in the Notes panel; anchor a note to an AAD section to point the planner at it.</span>
        </div>
        {allNotes.length ? (
          <ul className="space-y-1.5">
            {allNotes.map((n) => {
              const anchor = anchorLabel(n.anchor, docLabels);
              return (
                <li key={n.id} className="flex min-w-0 items-baseline gap-2 rounded-[14px] bg-well px-3.5 py-2.5 text-sm">
                  <StickyNote aria-hidden className="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    {anchor ? <span className="mr-1 font-mono text-[11px] text-primary">[{anchor}]</span> : null}
                    {n.text}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{n.sentToRunId ? `sent to ${n.sentToRunId}` : "sent with the next run"}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No notes yet. The planner works from the documents alone.</p>
        )}
      </div>
    </section>
  );
}

function groupByWave(tasks: readonly DeliveryTask[]): Array<[number, DeliveryTask[]]> {
  const by = new Map<number, DeliveryTask[]>();
  for (const t of tasks) by.set(t.wave, [...(by.get(t.wave) ?? []), t]);
  return [...by.entries()].sort((a, b) => a[0] - b[0]);
}

const REPORT_TABS: Array<{ key: keyof PlanReport; label: string; empty: string }> = [
  { key: "assumptions", label: "Assumptions", empty: "No assumptions recorded." },
  { key: "openQuestions", label: "Open questions", empty: "No open questions." },
  { key: "uncovered", label: "Requirements not covered by a task", empty: "Every requirement is covered by a task." },
  { key: "risks", label: "Risks", empty: "No risks recorded." },
];

function ApprovedPlan({ projectId, bundle, run, onOpenExecution }: { projectId: string; bundle: ProjectBundle; run?: RunDetail; onOpenExecution: () => void }) {
  const record = bundle.project.stages.implementation;
  const tasks = bundle.tasks;
  const waves = useMemo(() => groupByWave(tasks), [tasks]);
  const repos = new Set(tasks.map((t) => t.repo)).size;
  const approval = bundle.activity.filter((a) => a.type === "plan.approved").sort((a, b) => b.at - a.at)[0];
  const plan = docOf(bundle, "plan");
  const report = (run?.output as DevPlanOutput | undefined)?.report;
  const rounds = (run?.output as DevPlanOutput | undefined)?.rounds;
  const done = tasks.filter((t) => t.status === "done").length;

  return (
    <SectionCard
      density="dense"
      title={`${plural(tasks.length, "task")} in ${plural(waves.length, "wave")} across ${plural(repos, "repo")}`}
      description={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1">
          <StatusPill tone="success" icon={CheckCircle2} size="sm" label="Plan approved" />
          {approval ? <span>by {actorText(approval.actor)}</span> : null}
          {record.planApprovedAt ? <RelativeTime at={record.planApprovedAt} /> : null}
          {record.startMode ? <span>· Start: {START_MODE_LABELS[record.startMode]}</span> : null}
          {rounds ? <span>· {plural(rounds, "planning round")}</span> : null}
        </span>
      }
      cardMenu={<CircleIconButton icon={ArrowRight} label={`Open Execution, ${done} of ${tasks.length} tasks done`} onClick={onOpenExecution} />}
    >
      <div className="@container space-y-5">
        <div className="space-y-3">
          {waves.map(([wave, list]) => (
            <WaveLane key={wave} wave={wave} count={list.length}>
              {list.map((t) => (
                <li key={t.id}>
                  <Link href={taskHref(projectId, t.id)} className={cn(RAISED_ROW, "flex min-w-0 flex-col gap-2 px-3.5 py-3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none")}>
                    <span className="flex min-w-0 flex-wrap items-start gap-x-2.5 gap-y-1">
                      <TaskIdLabel task={t} className="shrink-0 pt-px" />
                      <span className="order-last min-w-0 basis-full text-sm leading-5 font-medium text-heading @xl:order-none @xl:flex-1 @xl:basis-auto">
                        <ScopedTitle title={t.title} hideScope={t.repo} />
                      </span>
                      <StatusPill status={{ kind: "task", value: t.status }} size="sm" className="ml-auto" />
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <RepoChip repo={t.repo} />
                      <SizeChip size={t.size} />
                      <DepChips deps={t.dependencies} />
                      <TraceChips traces={t.traces} max={6} />
                    </span>
                  </Link>
                </li>
              ))}
            </WaveLane>
          ))}
        </div>

        {report ? <PlanReportTabs report={report} /> : null}

        {plan ? (
          <Link href={docHref(projectId, plan)} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            Open the plan file <span className="font-mono text-xs text-muted-foreground">{plan.path}</span>
            <ArrowUpRight aria-hidden className="size-3.5" />
          </Link>
        ) : null}
      </div>
    </SectionCard>
  );
}

/** The planner's report: a segmented tab strip with counts over the chosen list. */
function PlanReportTabs({ report }: { report: PlanReport }) {
  const [tab, setTab] = useState<keyof PlanReport>("assumptions");
  const base = useId();
  const current = REPORT_TABS.find((t) => t.key === tab) ?? REPORT_TABS[0]!;
  return (
    <div className="min-w-0 space-y-3">
      <SegmentedControl
        role="tablist"
        aria-label="Planner report"
        value={tab}
        onValueChange={setTab}
        items={REPORT_TABS.map((t) => ({ value: t.key, label: t.label, count: report[t.key].length, id: `${base}-${t.key}-tab`, controls: `${base}-panel` }))}
      />
      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-${current.key}-tab`} tabIndex={0} className="rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        {report[current.key].length ? (
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-[22px] marker:text-muted-foreground">
            {report[current.key].map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{current.empty}</p>
        )}
      </div>
    </div>
  );
}
