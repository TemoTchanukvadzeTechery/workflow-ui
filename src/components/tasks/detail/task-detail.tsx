"use client";

/**
 * The task page (/projects/[projectId]/tasks/[taskId], brief C.3 task detail, D.3 pattern 10):
 * header with ids, status, epic, repo, branch, size, wave, dependencies and traces; an attempt
 * picker over the task's dev-task and qa-verify runs; the live RunLedger of the selected run on
 * the left and tabs on the right (Changes, Checks, Acceptance criteria, Agent log, Evidence,
 * Notes). A pending task:review / qa:review is answered in the review area under the header
 * (?request=<runId>:<hId> focuses it), with a sticky bar pointing to it while it is off screen.
 * The review form lists the changed files and hands the diff itself to the Changes tab
 * (TaskReviewHostContext), so the page never shows the same diff twice.
 */
import { ArrowDown, ArrowLeft, Check, Copy, Eye, FolderX, GitBranch, Hourglass, Link2, ListTodo, Play, RefreshCw, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleIconButton, Duration, Elapsed, EmptyState, ErrorState, SegmentedControl, StatusDot, StatusPill } from "@/components/common";
import { EvidenceGallery } from "@/components/evidence";
import { HumanRequestCard, Notice } from "@/components/hitl";
import { TaskReviewHostContext, type TaskReviewHost } from "@/components/hitl/forms/TaskReviewForm";
import { RunLedger, defaultSeq } from "@/components/runs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCopy } from "@/hooks/use-copy";
import { stageHref, useStageParams, type RequestFocus } from "@/hooks/use-stage-params";
import { ApiError } from "@/lib/api/client";
import { usePatchTask, useProject, useRetryTask, useRun } from "@/lib/api/queries";
import type { DeliveryTask, InboxItem, ProjectBundle } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { qaStatusMeta, runStatusMeta } from "@/lib/weft/labels";
import { TERMINAL_RUN_STATUSES, type RunStatus } from "@/lib/weft/types";
import {
  AgentAvatar,
  BlockedLine,
  DepChips,
  EscalatedBadge,
  MAX_REWORK,
  QaReworkBadge,
  RepoChip,
  ReworkBadge,
  ScopedTitle,
  TaskIdLabel,
  TraceChips,
  attemptStartedAt,
  isAgentWorking,
  isQueued,
  latestChecks,
  waitReason,
} from "../task-bits";
import { useStartTasksWorded } from "../use-start-tasks";
import { ChangesPanel } from "./changes";
import { ChecksPanel, CriteriaPanel } from "./checks";
import { AgentLogPanel, TaskNotesPanel } from "./log";

// ---------------------------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------------------------

interface Attempt {
  runId: string;
  kind: "dev" | "qa";
  n: number;
  label: string;
  status?: RunStatus;
  createdAt: number;
}

function attemptsOf(bundle: ProjectBundle, task: DeliveryTask): Attempt[] {
  const known = new Map(Object.values(bundle.stages).flatMap((v) => v.runs.map((r) => [r.runId, r] as const)));
  const firstQa = task.qa.runIds.map((id) => known.get(id)?.createdAt ?? Infinity).reduce((a, b) => Math.min(a, b), Infinity);
  const dev = task.runIds.map((runId, i): Attempt => {
    const r = known.get(runId);
    const createdAt = r?.createdAt ?? i;
    return { runId, kind: "dev", n: i + 1, label: `Attempt ${i + 1}${createdAt > firstQa ? " · QA fix" : ""}`, status: r?.status, createdAt };
  });
  const qa = task.qa.runIds.map((runId, i): Attempt => {
    const r = known.get(runId);
    return { runId, kind: "qa", n: i + 1, label: `QA ${i + 1}`, status: r?.status, createdAt: r?.createdAt ?? task.runIds.length + i };
  });
  return [...dev, ...qa].sort((a, b) => a.createdAt - b.createdAt);
}

/** The task's runs as a segmented control: status dot, "Attempt 2", the workflow and run id. */
function AttemptPicker({ attempts, value, onChange }: { attempts: Attempt[]; value: string; onChange: (runId: string) => void }) {
  return (
    <SegmentedControl
      aria-label="Attempt"
      value={value}
      onValueChange={onChange}
      items={attempts.map((a) => {
        const meta = a.status ? runStatusMeta(a.status) : undefined;
        const wf = a.kind === "dev" ? "dev-task" : "qa-verify";
        return {
          value: a.runId,
          ariaLabel: `${a.label}, ${wf} ${a.runId}${meta ? `, ${meta.label}` : ""}`,
          label: (
            <span className="inline-flex items-center gap-2">
              {meta ? <StatusDot tone={meta.tone} pulse={meta.pulse} size="sm" /> : null}
              {a.label}
              <span className="hidden font-mono text-xs font-normal text-muted-foreground sm:inline">
                {wf} {a.runId}
              </span>
            </span>
          ),
        };
      })}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------------------------

function TaskSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading task">
      <Skeleton className="h-4 w-40" />
      <div className="card-surface space-y-3 rounded-2xl p-5">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-8 w-2/3" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      </div>
      <div className="flex gap-1.5">
        <Skeleton className="h-9 w-56 rounded-full" />
        <Skeleton className="h-9 w-40 rounded-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="card-surface space-y-2 rounded-2xl p-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
        <div className="card-surface space-y-3 rounded-2xl p-4">
          <Skeleton className="h-8 w-80 max-w-full rounded-full" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export function TaskDetailView({ projectId, taskId }: { projectId: string; taskId: string }) {
  const q = useProject(projectId);
  const { request, clearRequest } = useStageParams();
  const bundle = q.data;
  if (!bundle) {
    if (q.isPending) return <TaskSkeleton />;
    if (q.error instanceof ApiError && q.error.status === 404) {
      return <EmptyState icon={FolderX} title="Project not found" body={`No project with id "${projectId}". It may have been deleted, or the demo data was reset.`} />;
    }
    return <ErrorState title="Could not load the task" error={q.error} onRetry={() => void q.refetch()} />;
  }
  const task = bundle.tasks.find((t) => t.id === taskId);
  if (!task) {
    return (
      <EmptyState
        icon={ListTodo}
        title="Task not found"
        body={`${taskId} is not part of this project's plan.`}
        action={
          <Button asChild variant="secondary">
            <Link href={stageHref(projectId, "implementation", { step: "execution" })}>Open the task board</Link>
          </Button>
        }
      />
    );
  }
  return <TaskDetail key={task.id} projectId={projectId} bundle={bundle} task={task} request={request} onClearRequest={clearRequest} />;
}

function TaskDetail({ projectId, bundle, task, request, onClearRequest }: { projectId: string; bundle: ProjectBundle; task: DeliveryTask; request: RequestFocus | null; onClearRequest: () => void }) {
  const attempts = attemptsOf(bundle, task);
  const pending = bundle.inbox.filter((i): i is Extract<InboxItem, { kind: "human" }> => i.kind === "human" && i.taskId === task.id);
  const requestKey = request ? `${request.runId}:${request.requestId}` : undefined;
  const requestAttempt = request ? attempts.find((a) => a.runId === request.runId) : undefined;
  const latestQaActive = [...attempts].reverse().find((a) => a.kind === "qa" && a.status && !TERMINAL_RUN_STATUSES.includes(a.status));
  const fallback = requestAttempt ?? latestQaActive ?? attempts[attempts.length - 1];

  const [picked, setPicked] = useState<string | null>(null);
  const runId = attempts.some((a) => a.runId === picked) ? picked! : fallback?.runId;
  const attempt = attempts.find((a) => a.runId === runId);
  const runQ = useRun(runId);
  const run = runQ.data;
  const latestDev = task.runIds.at(-1);
  const devRunId = attempt?.kind === "dev" ? runId : latestDev;
  const devQ = useRun(devRunId);

  const [sel, setSel] = useState<{ runId: string; seq: number } | null>(null);
  // Requests answered in the review area are not opened again in the Agent log: the default step
  // is then the latest agent step, and picking one in the ledger scrolls to the review instead.
  const reviewSeqs = run ? run.humans.filter((h) => h.status === "pending" && pending.some((p) => p.entry.runId === run.runId && p.entry.id === h.id)).map((h) => h.seq) : [];
  const baseSeq = run ? defaultSeq(run) : undefined;
  const lastAgent = run ? [...run.steps].reverse().find((s) => s.kind === "agent")?.seq : undefined;
  const seq = sel && sel.runId === runId ? sel.seq : baseSeq !== undefined && reviewSeqs.includes(baseSeq) ? (lastAgent ?? baseSeq) : baseSeq;
  const taskEvidence = bundle.evidence.filter((e) => e.taskId === task.id);
  const defaultTab = attempt?.kind === "qa" ? (taskEvidence.length ? "evidence" : "checks") : "changes";
  const [tab, setTab] = useState<string | null>(null);
  const activeTab = tab === "evidence" && !taskEvidence.length ? defaultTab : (tab ?? defaultTab);
  const [evFocus, setEvFocus] = useState<string | undefined>(undefined);
  const logRef = useRef<HTMLElement>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const [reviewVisible, setReviewVisible] = useState(true);

  useEffect(() => {
    const el = reviewRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setReviewVisible(!!entry?.isIntersecting), { rootMargin: "0px 0px -80px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [pending.length]);

  const selectStep = (s: number) => {
    if (!runId) return;
    if (reviewSeqs.includes(s)) {
      reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setSel({ runId, seq: s });
    setTab("log");
    window.requestAnimationFrame(() => {
      const el = logRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top > window.innerHeight - 120 || r.bottom < 80) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const openEvidence = (id: string) => {
    setEvFocus(id);
    setTab("evidence");
  };

  // "Open the diff in Changes" from the review form: that run's attempt, the Changes tab, in view.
  const reviewHost: TaskReviewHost = {
    openChanges: (id: string) => {
      setPicked(id);
      setTab("changes");
      window.requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    },
  };

  const checks = latestChecks(run?.checks ?? []);
  const passed = checks.filter((c) => c.status === "pass").length;
  const met = task.acceptanceCriteria.filter((a) => a.met).length;
  const devAttempt = attempts.find((a) => a.runId === devRunId);

  return (
    <div className="@container/task flex min-w-0 flex-col gap-5">
      <TaskHeader projectId={projectId} bundle={bundle} task={task} branchFallback={branchOf(devQ.data)} />

      {pending.length > 0 || (request && !pending.some((p) => p.entry.runId === request.runId && p.entry.id === request.requestId)) ? (
        <section ref={reviewRef} aria-label="Review" className="scroll-mt-20 space-y-3">
          <TaskReviewHostContext.Provider value={reviewHost}>
          {pending.map((p) => (
            <HumanRequestCard
              key={`${p.entry.runId}:${p.entry.id}`}
              runId={p.entry.runId}
              request={p.entry}
              workflow={p.entry.workflow}
              projectId={projectId}
              focused={requestKey === `${p.entry.runId}:${p.entry.id}`}
              onAnswered={() => {
                if (requestKey) onClearRequest();
              }}
            />
          ))}
          {request && !pending.some((p) => p.entry.runId === request.runId && p.entry.id === request.requestId) ? <PastRequest projectId={projectId} request={request} /> : null}
          </TaskReviewHostContext.Provider>
        </section>
      ) : null}

      {attempts.length === 0 ? (
        <EmptyState
          icon={Play}
          title="No agent has worked on this task yet"
          body={
            task.status === "ready"
              ? (() => {
                  const wait = waitReason(task, bundle.tasks);
                  return wait ? `${isQueued(task) ? "Queued: it" : "It"} ${wait}.` : "Start it from the task board, or wait for its wave to start.";
                })()
              : task.status === "blocked"
                ? `It is blocked${task.blockedBy ? `: ${task.blockedBy}` : ""}.`
                : "It starts once the plan is approved and its dependencies are done."
          }
        />
      ) : (
        <>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <span className="shrink-0 text-[15px] text-muted-foreground">Attempts</span>
            <div className="order-last min-w-0 basis-full @2xl/task:order-none @2xl/task:basis-auto @2xl/task:flex-1">
              <AttemptPicker attempts={attempts} value={runId ?? ""} onChange={setPicked} />
            </div>
            {runId ? (
              <Link href={`/runs/${runId}`} className="ml-auto text-[13px] font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                Open in run inspector
              </Link>
            ) : null}
          </div>

          <div className="grid min-w-0 gap-4 @5xl/task:grid-cols-[340px_minmax(0,1fr)]">
            <aside aria-label="Run ledger" className="card-surface order-last max-h-[420px] min-w-0 self-start overflow-y-auto rounded-2xl @5xl/task:sticky @5xl/task:top-16 @5xl/task:order-none @5xl/task:max-h-[calc(100vh-5rem)]">
              {run ? (
                <RunLedger run={run} selectedSeq={seq} onSelect={selectStep} compact title={`${attempt?.label ?? "Run"} · ${run.workflow} ${run.runId}`} />
              ) : runQ.error ? (
                <ErrorState size="sm" title="Could not load the run" error={runQ.error} onRetry={() => void runQ.refetch()} />
              ) : (
                <div className="space-y-2 p-3" aria-busy="true">
                  {Array.from({ length: 10 }, (_, i) => (
                    <Skeleton key={i} className="h-7 w-full" />
                  ))}
                </div>
              )}
            </aside>

            <section ref={detailsRef} aria-label="Task details" className="card-surface min-w-0 scroll-mt-20 rounded-2xl p-4 sm:p-5">
              <Tabs value={activeTab} onValueChange={setTab} className="min-w-0 gap-5">
                <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
                  <TabsList className="flex-nowrap justify-start">
                    <TabTrigger value="changes">Changes</TabTrigger>
                    <TabTrigger value="checks" count={checks.length ? `${passed}/${checks.length}` : undefined}>
                      Checks
                    </TabTrigger>
                    <TabTrigger value="criteria" count={`${met}/${task.acceptanceCriteria.length}`}>
                      Acceptance criteria
                    </TabTrigger>
                    <TabTrigger value="log">Agent log</TabTrigger>
                    {taskEvidence.length ? (
                      <TabTrigger value="evidence" count={String(taskEvidence.length)}>
                        Evidence
                      </TabTrigger>
                    ) : null}
                    <TabTrigger value="notes">Notes</TabTrigger>
                  </TabsList>
                </div>
                <TabsContent value="changes" className="min-w-0">
                  {devRunId ? (
                    <ChangesPanel key={devRunId} runId={devRunId} attemptLabel={attempt?.kind === "qa" && devAttempt ? `${devAttempt.label}, the build QA tested` : undefined} />
                  ) : (
                    <p className="text-sm text-muted-foreground">No dev-task run yet.</p>
                  )}
                </TabsContent>
                <TabsContent value="checks" className="min-w-0">
                  {run ? <ChecksPanel key={run.runId} run={run} /> : <PanelSkeleton />}
                </TabsContent>
                <TabsContent value="criteria" className="min-w-0">
                  <CriteriaPanel task={task} runs={devQ.data ? [devQ.data] : []} evidence={bundle.evidence} onOpenEvidence={openEvidence} />
                </TabsContent>
                <TabsContent value="log" className="min-w-0">
                  {run ? <AgentLogPanel paneRef={logRef} run={run} seq={seq} onSelect={(s) => setSel({ runId: run.runId, seq: s })} projectId={projectId} /> : <PanelSkeleton />}
                </TabsContent>
                {taskEvidence.length ? (
                  <TabsContent value="evidence" className="min-w-0">
                    <EvidenceGallery projectId={projectId} task={task} evidence={bundle.evidence} focusEvidenceId={evFocus} />
                  </TabsContent>
                ) : null}
                <TabsContent value="notes" className="min-w-0">
                  <TaskNotesPanel projectId={projectId} task={task} bundle={bundle} />
                </TabsContent>
              </Tabs>
            </section>
          </div>
        </>
      )}

      {pending.length > 0 && !reviewVisible ? <ReviewBar task={task} label={pending[0]!.key} onGo={() => reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} /> : null}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function TabTrigger({ value, count, children }: { value: string; count?: string; children: ReactNode }) {
  return (
    <TabsTrigger value={value} className="flex-none">
      {children}
      {count ? <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span> : null}
    </TabsTrigger>
  );
}

/** A ?request= that is no longer pending: show what was answered. */
function PastRequest({ projectId, request }: { projectId: string; request: RequestFocus }) {
  const q = useRun(request.runId);
  const human = q.data?.humans.find((h) => h.id === request.requestId);
  if (q.isPending) return <Skeleton className="h-16 w-full rounded-2xl" />;
  if (!human) return <Notice tone="neutral">Request {request.requestId} of run {request.runId} was not found. It may belong to another task.</Notice>;
  return <HumanRequestCard runId={request.runId} request={human} workflow={q.data?.workflow} projectId={projectId} />;
}

function ReviewBar({ task, label, onGo }: { task: DeliveryTask; label?: string; onGo: () => void }) {
  const qa = label?.startsWith("qa:review:");
  return (
    <div className="glass sticky bottom-4 z-20 mx-auto flex w-full max-w-2xl items-center gap-3 rounded-[20px] py-1.5 pr-1.5 pl-4" role="region" aria-label="Pending review">
      <Eye aria-hidden className="size-4 shrink-0 text-status-review-fg" />
      <p className="min-w-0 flex-1 truncate text-sm">
        <span className="font-medium text-heading">{task.jiraKey ?? task.id}</span> is waiting for your {qa ? "QA review" : "review"}
        {label ? <span className="ml-1.5 font-mono text-xs text-muted-foreground">{label}</span> : null}
      </p>
      <Button className="shrink-0 bg-status-review-fg text-white dark:text-background" onClick={onGo}>
        Review now
        <ArrowDown aria-hidden />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------------------------

function branchOf(run: { steps: Array<{ kind: string; key?: string; output?: unknown }> } | undefined): string | undefined {
  const step = run?.steps.find((s) => s.kind === "git" && s.key === "git:branch");
  const out = step?.output as { branch?: unknown } | undefined;
  return typeof out?.branch === "string" ? out.branch : undefined;
}

function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <dt className="text-[13px] leading-5 text-muted-foreground">{label}</dt>
      <dd className="flex min-h-6 min-w-0 flex-wrap items-center gap-1.5 text-[15px] leading-6 text-heading">{children}</dd>
    </div>
  );
}

function CopyBranch({ branch }: { branch: string }) {
  const { copied, copy } = useCopy();
  return (
    <span className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full bg-well pr-1 pl-2.5 font-mono text-xs text-heading">
      <GitBranch aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate" title={branch}>
        {branch}
      </span>
      <button
        type="button"
        onClick={() => void copy(branch, "the branch name")}
        aria-label={copied ? "Branch name copied" : "Copy branch name"}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-raised hover:text-heading focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {copied ? <Check aria-hidden className="size-3" /> : <Copy aria-hidden className="size-3" />}
      </button>
    </span>
  );
}

function TaskHeader({ projectId, bundle, task, branchFallback }: { projectId: string; bundle: ProjectBundle; task: DeliveryTask; branchFallback?: string }) {
  const epic = bundle.epics.find((e) => e.id === task.epicId);
  const impl = bundle.stages.implementation;
  const canManage = !!bundle.project.stages.implementation.planApprovedAt && impl.status !== "approved" && impl.status !== "locked" && !bundle.project.done;
  const showQa = task.qa.status !== "pending" || task.qa.runIds.length > 0;
  const qaMeta = qaStatusMeta(task.qa.status);
  const branch = task.branch || branchFallback;
  const working = isAgentWorking(task);
  const start = useStartTasksWorded(projectId);
  const retry = useRetryTask(projectId);
  const patch = usePatchTask(projectId);
  const latestRun = impl.runs.find((r) => r.runId === task.runIds.at(-1)) ?? bundle.stages.qa.runs.find((r) => r.runId === task.runIds.at(-1));
  const canRetry = canManage && !!latestRun && (latestRun.status === "failed" || latestRun.status === "cancelled") && task.status !== "done" && task.status !== "cancelled";
  const canStart = canManage && task.status === "ready" && !isQueued(task);
  const inQa = impl.status === "approved" && task.qa.runIds.length > 0;
  const wait = waitReason(task, bundle.tasks);
  const runStarts = new Map([...impl.runs, ...bundle.stages.qa.runs].map((r) => [r.runId, r.createdAt] as const));
  const since = working ? attemptStartedAt(task, (id) => runStarts.get(id)) : undefined;

  return (
    <header className="space-y-5">
      <Link
        href={inQa ? stageHref(projectId, "qa", { step: "tasks" }) : stageHref(projectId, "implementation", { step: "execution" })}
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-heading focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {inQa ? "QA Certification · tasks" : "Implementation · task board"}
      </Link>
      <div className="flex flex-col gap-4 @3xl/task:flex-row @3xl/task:items-end @3xl/task:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <TaskIdLabel task={task} className="text-[13px]" />
          <div className="flex min-w-0 items-start gap-2.5">
            <h1 className="min-w-0 text-[28px] leading-[1.14] font-normal tracking-[-0.025em] break-words text-heading @3xl/task:text-[36px] @3xl/task:leading-[1.1] @3xl/task:tracking-[-0.03em] @6xl/task:text-[40px]">
              <ScopedTitle title={task.title} />
            </h1>
            <CopyTaskLink />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={{ kind: "task", value: task.status }} pulse={working} />
            {showQa ? <StatusPill {...qaMeta} label={`QA · ${qaMeta.label}`} variant="chip" /> : null}
            {task.reworkFrom === "qa" ? <QaReworkBadge /> : null}
            <ReworkBadge count={task.reworkCount} max={MAX_REWORK} />
            {task.escalated ? <EscalatedBadge /> : null}
            <span className="chip-float text-[13px]">
              <span className="text-muted-foreground">Wave</span>
              <span className="font-medium tabular-nums">{task.wave}</span>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <span className="text-muted-foreground">Size</span>
              <span className="font-mono font-medium">{task.size}</span>
            </span>
          </div>
        </div>
        {canStart || canRetry || (canManage && task.status === "blocked") ? (
          <div className="flex flex-wrap items-center gap-2">
            {canStart ? (
              <Button disabled={start.isPending} onClick={() => start.mutate({ body: { taskIds: [task.id] }, targets: [task], tasks: bundle.tasks })}>
                {start.isPending ? <Spinner aria-hidden /> : <Play aria-hidden />}
                Start task
              </Button>
            ) : null}
            {canRetry ? (
              <Button variant="secondary" disabled={retry.isPending} onClick={() => retry.mutate(task.id)}>
                {retry.isPending ? <Spinner aria-hidden /> : <RefreshCw aria-hidden />}
                Retry task
              </Button>
            ) : null}
            {canManage && task.status === "blocked" ? (
              <Button variant="secondary" disabled={patch.isPending} onClick={() => patch.mutate({ taskId: task.id, body: { status: "ready" } })}>
                <Undo2 aria-hidden />
                Mark ready (unblock)
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <section aria-label="About this task" className="card-surface space-y-5 rounded-2xl p-5 @3xl/task:p-6">
        {task.status === "blocked" ? <BlockedLine reason={task.blockedBy} /> : null}
        {wait ? (
          <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
            <Hourglass aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {isQueued(task) ? "Queued · " : ""}
              {wait.charAt(0).toUpperCase() + wait.slice(1)}
            </span>
          </p>
        ) : null}
        {task.description ? <p className="max-w-3xl text-[15px] leading-6 text-foreground/85">{task.description}</p> : null}

        <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-4 @4xl/task:grid-cols-4", (task.description || wait || task.status === "blocked") && "border-t border-rule pt-5")}>
          <Fact label="Epic" className="col-span-2">
            {epic ? (
              <span className="min-w-0 truncate" title={epic.title}>
                <span className="font-mono text-[13px] text-muted-foreground">{epic.key ?? epic.id}</span> {epic.title}
              </span>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </Fact>
          <Fact label="Repo">
            <RepoChip repo={task.repo} />
          </Fact>
          <Fact label="Type · priority">
            <span className="capitalize">{task.type}</span>
            <span className="text-muted-foreground">·</span>
            <span className="capitalize">{task.priority}</span>
          </Fact>
          <Fact label="Branch" className="col-span-2">
            {branch ? <CopyBranch branch={branch} /> : <span className="text-muted-foreground">Created when the agent starts</span>}
          </Fact>
          <Fact label="Depends on">
            {task.dependencies.length ? <DepChips deps={task.dependencies} tasks={bundle.tasks} projectId={projectId} /> : <span className="text-muted-foreground">Nothing</span>}
          </Fact>
          <Fact label="Traces">
            {task.traces.length ? <TraceChips traces={task.traces} /> : <span className="text-muted-foreground">-</span>}
          </Fact>
          <Fact label="Agent" className="col-span-2 @4xl/task:col-span-4">
            {working ? (
              <>
                <AgentAvatar live />
                {since ? (
                  <span title={task.reworkCount > 0 && task.devReview?.decision === "changes_requested" ? `Time on rework ${task.reworkCount}` : "Time on this attempt"}>
                    <Elapsed since={since} className="font-mono text-[13px] text-status-running-fg tabular-nums" />
                  </span>
                ) : null}
              </>
            ) : task.startedAt && task.finishedAt ? (
              <span className="text-muted-foreground">
                Done in <Duration ms={task.finishedAt - task.startedAt} />
              </span>
            ) : task.runIds.length ? (
              <span className="text-muted-foreground">{task.latestStep ?? "Waiting"}</span>
            ) : (
              <span className="text-muted-foreground">Not started</span>
            )}
          </Fact>
        </dl>
        {working && task.latestStep ? (
          <p className="flex min-w-0 items-center gap-2 rounded-[14px] bg-status-running-bg px-3.5 py-2.5 font-mono text-[13px] text-status-running-fg" aria-live="polite">
            <StatusDot tone="running" pulse size="sm" />
            <span className="truncate">{task.latestStep}</span>
          </p>
        ) : null}
      </section>
    </header>
  );
}

/** The reference's raised "copy link" circle beside the title. */
function CopyTaskLink() {
  const { copied, copy } = useCopy();
  return (
    <CircleIconButton
      variant="raised"
      size="sm"
      icon={copied ? Check : Link2}
      label={copied ? "Link copied" : "Copy link to this task"}
      className="mt-1 @3xl/task:mt-2"
      onClick={() => void copy(window.location.href.split("?")[0] ?? window.location.href, "the task link")}
    />
  );
}
