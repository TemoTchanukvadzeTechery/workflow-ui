"use client";

/**
 * Small pieces shared by the task board, the plan editor and the task page: ids, repo/size/trace
 * chips, dependency chips, check and diff stats, rework/escalation badges and the agent avatar.
 * Status is never color-only: every badge carries an icon and a text label.
 */
import { AlertTriangle, Bot, FolderGit2, ListChecks, OctagonPause, RotateCcw, Undo2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { StatusDot, StatusPill } from "@/components/common";
import type { DeliveryTask } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { taskStatusMeta } from "@/lib/weft/labels";
import type { CheckState } from "@/lib/weft/types";

/** Rework limit used by dev-task (SPEC 4.1 maxReworkCycles). */
export const MAX_REWORK = 2;

/** Default model the dev-task workflow routes its agents to. */
export const DEFAULT_AGENT_MODEL = "claude-opus-5";

/** "[customer-service-v2] Coverage endpoint" -> { scope: "customer-service-v2", rest: "Coverage endpoint" }. */
export function splitScope(title: string): { scope?: string; rest: string } {
  const m = /^\s*\[([^\]]+)\]\s*(.*)$/.exec(title);
  if (!m) return { rest: title };
  return { scope: m[1], rest: m[2] || title };
}

/** Jira key when synced, else the task id. */
export function taskKey(t: Pick<DeliveryTask, "id" | "jiraKey">): string {
  return t.jiraKey ?? t.id;
}

export function taskHref(projectId: string, taskId: string, request?: string): string {
  return `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}${request ? `?request=${encodeURIComponent(request)}` : ""}`;
}

/** An agent holds the task: implementing, verifying or reworking. */
export function isAgentWorking(t: Pick<DeliveryTask, "status">): boolean {
  return t.status === "in_progress" || t.status === "verifying" || t.status === "changes_requested";
}

/** Ready, but the orchestrator holds it back (dependencies or the agent limit): "Queued: …". */
export function isQueued(t: Pick<DeliveryTask, "status" | "latestStep">): boolean {
  return t.status === "ready" && !!t.latestStep?.startsWith("Queued");
}

/** Dependencies not approved (done) or cancelled yet. */
export function unmetDeps(task: Pick<DeliveryTask, "dependencies">, tasks: readonly DeliveryTask[]): string[] {
  return task.dependencies.filter((d) => {
    const dep = tasks.find((t) => t.id === d);
    return dep && dep.status !== "done" && dep.status !== "cancelled";
  });
}

function joinAnd(xs: readonly string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

/**
 * Why a ready task has not started: "starts after T-7 is approved" (a dependency is not done yet)
 * or, when queued with nothing to wait for, "starts when an agent is free". Null when nothing
 * holds it back.
 */
export function waitReason(task: DeliveryTask, tasks: readonly DeliveryTask[], agentLimit = 3): string | null {
  if (task.status !== "ready") return null;
  const deps = unmetDeps(task, tasks);
  if (deps.length) return `starts after ${joinAnd(deps)} ${deps.length === 1 ? "is" : "are"} approved`;
  if (isQueued(task)) return `starts when an agent is free (${agentLimit} at most)`;
  return null;
}

/**
 * When the agent's current stint on the task began: the latest attempt's run (a retry or a QA
 * loop-back starts a new one), or the review that asked for the rework in progress. startedAt
 * is the first start ever, so an elapsed timer from it overstates a rework.
 */
export function attemptStartedAt(task: Pick<DeliveryTask, "startedAt" | "runIds" | "reworkCount" | "devReview" | "qa">, runCreatedAt?: (runId: string) => number | undefined): number | undefined {
  const candidates = [
    task.startedAt,
    task.runIds.length ? runCreatedAt?.(task.runIds[task.runIds.length - 1]!) : undefined,
    task.reworkCount > 0 && task.devReview?.decision === "changes_requested" ? task.devReview.at : undefined,
    task.qa.review?.decision === "changes_requested" ? task.qa.review.at : undefined,
  ].filter((x): x is number => typeof x === "number");
  return candidates.length ? Math.max(...candidates) : undefined;
}

/** Latest result per check name (a retried check keeps its last outcome). */
export function latestChecks(checks: readonly CheckState[]): CheckState[] {
  const by = new Map<string, CheckState>();
  for (const c of checks) by.set(c.name, c);
  return [...by.values()];
}

/** "T-4 · CP-52153" in mono. */
export function TaskIdLabel({ task, className }: { task: Pick<DeliveryTask, "id" | "jiraKey">; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 font-mono text-[11px] text-muted-foreground tabular-nums", className)}>
      <span className="shrink-0 whitespace-nowrap text-foreground">{task.id}</span>
      {task.jiraKey ? (
        <>
          <span aria-hidden className="shrink-0">·</span>
          <span className="min-w-0 truncate">{task.jiraKey}</span>
        </>
      ) : null}
    </span>
  );
}

/** Title with its "[scope]" prefix rendered as a muted mono tag. */
export function ScopedTitle({ title, hideScope, className }: { title: string; hideScope?: string; className?: string }) {
  const { scope, rest } = splitScope(title);
  const showScope = scope && scope !== hideScope;
  return (
    <span className={cn("min-w-0 break-words", className)}>
      {showScope ? <span className="mr-1 font-mono text-[0.85em] text-muted-foreground">[{scope}]</span> : null}
      {scope ? rest : title}
    </span>
  );
}

export function RepoChip({ repo, className }: { repo: string; className?: string }) {
  return (
    <span title={repo} className={cn("inline-flex h-5 max-w-full min-w-0 items-center gap-1 rounded-md bg-muted px-1.5 font-mono text-[11px] text-muted-foreground", className)}>
      <FolderGit2 aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{repo}</span>
    </span>
  );
}

export function MiniChip({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-5 shrink-0 items-center rounded-md border border-border px-1.5 font-mono text-[11px] leading-none text-muted-foreground", className)}>
      {children}
    </span>
  );
}

export function SizeChip({ size }: { size: string }) {
  return <MiniChip title={`Size ${size}`}>{size}</MiniChip>;
}

export function TraceChips({ traces, max, className }: { traces: readonly string[]; max?: number; className?: string }) {
  if (traces.length === 0) return null;
  const shown = max ? traces.slice(0, max) : traces;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)} aria-label={`Traces ${traces.join(", ")}`}>
      {shown.map((t) => (
        <span key={t} className="inline-flex h-5 items-center rounded-md bg-primary-soft px-1.5 font-mono text-[11px] text-primary">
          {t}
        </span>
      ))}
      {max && traces.length > max ? <span className="font-mono text-[11px] text-muted-foreground">+{traces.length - max}</span> : null}
    </span>
  );
}

/** Dependency chips; with `tasks` each chip shows the dependency's status dot and links to it. */
export function DepChips({ deps, tasks, projectId, className }: { deps: readonly string[]; tasks?: readonly DeliveryTask[]; projectId?: string; className?: string }) {
  if (deps.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      <span className="text-[11px] text-muted-foreground">after</span>
      {deps.map((d) => {
        const dep = tasks?.find((t) => t.id === d);
        const meta = dep ? taskStatusMeta(dep.status) : undefined;
        const body = (
          <>
            {meta ? <StatusDot tone={meta.tone} size="sm" label={`${d}: ${meta.label}`} /> : null}
            {d}
          </>
        );
        return projectId && dep ? (
          <Link
            key={d}
            href={taskHref(projectId, d)}
            className="inline-flex h-5 items-center gap-1 rounded-md border border-border px-1.5 font-mono text-[11px] text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {body}
          </Link>
        ) : (
          <span key={d} className="inline-flex h-5 items-center gap-1 rounded-md border border-border px-1.5 font-mono text-[11px] text-muted-foreground">
            {body}
          </span>
        );
      })}
    </span>
  );
}

/** "4/4 checks" with a pass/fail icon; nothing while no check has run. */
export function ChecksStat({ checks, className }: { checks: readonly CheckState[]; className?: string }) {
  const latest = latestChecks(checks);
  if (latest.length === 0) return null;
  const passed = latest.filter((c) => c.status === "pass").length;
  const ok = passed === latest.length;
  return (
    <span
      className={cn("inline-flex items-center gap-1 font-mono text-[11px] tabular-nums", ok ? "text-status-success-fg" : "text-status-danger-fg", className)}
      title={`${passed} of ${latest.length} checks passed`}
    >
      <ListChecks aria-hidden className="size-3.5" />
      {passed}/{latest.length}
      <span className="font-sans text-muted-foreground">checks</span>
    </span>
  );
}

export function DiffStat({ stats, className }: { stats?: { adds: number; dels: number; files?: number }; className?: string }) {
  if (!stats) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 font-mono text-[11px] tabular-nums", className)} title={`${stats.adds} lines added, ${stats.dels} removed${stats.files !== undefined ? ` in ${stats.files} files` : ""}`}>
      <span className="text-status-success-fg">+{stats.adds}</span>
      <span className="text-status-danger-fg">−{stats.dels}</span>
    </span>
  );
}

export function ReworkBadge({ count, max = MAX_REWORK }: { count: number; max?: number }) {
  if (count <= 0) return null;
  return <StatusPill tone="attention" icon={RotateCcw} size="sm" label={`Rework ${count}/${max}`} title={`${count} of ${max} rework cycles used`} />;
}

export function EscalatedBadge() {
  return <StatusPill tone="danger" icon={AlertTriangle} size="sm" label="Escalated" title="Rework limit reached; the developer decides" />;
}

export function QaReworkBadge() {
  return <StatusPill tone="danger" icon={Undo2} size="sm" label="Rework from QA" title="QA found bugs; this attempt fixes them" />;
}

export function BlockedLine({ reason, className }: { reason?: string; className?: string }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-xs text-status-attention-fg", className)}>
      <OctagonPause aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 break-words">Blocked{reason ? `: ${reason}` : ""}</span>
    </p>
  );
}

/** A weft agent working the task: bot avatar + model id. */
export function AgentAvatar({ model = DEFAULT_AGENT_MODEL, live, className }: { model?: string; live?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} title={`Agent: ${model}`}>
      <span className={cn("relative inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary")}>
        <Bot aria-hidden className="size-3" />
        {live ? <StatusDot tone="running" pulse size="sm" className="absolute -right-0.5 -bottom-0.5 ring-2 ring-card" /> : null}
      </span>
      <span className="truncate font-mono text-[11px] text-muted-foreground">{model}</span>
    </span>
  );
}

/** Segmented pill toggle (Board | Table, filters). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: ReactNode; icon?: typeof Bot; count?: number }>;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex items-center gap-0.5 rounded-full bg-muted p-0.5", className)}>
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon ? <Icon aria-hidden className="size-3.5" /> : null}
            {o.label}
            {o.count !== undefined ? <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums">{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
