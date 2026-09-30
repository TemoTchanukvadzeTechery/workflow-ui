"use client";

/**
 * Task page tabs: Agent log (each agent step of the selected run with its route, time, spend,
 * summary and files, then the shared StepPane for the step picked in the ledger) and Notes (the
 * latest rework feedback, review decisions, QA bugs, this task's activity and the developer
 * notes that mention it, with an inline "Add note" that saves an Implementation note starting
 * with the task id).
 */
import { ArrowUpRight, Bot, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { useId, useState, type Ref } from "react";
import { Duration, Elapsed, RelativeTime, StatusPill, actorText } from "@/components/common";
import { StepPane } from "@/components/runs";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useAddNote } from "@/lib/api/queries";
import type { DeliveryTask, ProjectBundle } from "@/lib/delivery/types";
import { formatTokens, formatUsd, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { decisionMeta } from "@/lib/weft/labels";
import type { FileStat, RunDetail, StepState } from "@/lib/weft/types";

interface AgentOutput {
  summary?: string;
  files?: FileStat[];
  diffStats?: { adds: number; dels: number; files: number };
}

function agentOutput(step: StepState): AgentOutput {
  const o = step.output;
  return o && typeof o === "object" ? (o as AgentOutput) : {};
}

function AgentStepCard({ step, selected, onSelect }: { step: StepState; selected: boolean; onSelect: () => void }) {
  const out = agentOutput(step);
  const running = step.status === "running";
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          "flex w-full min-w-0 flex-col gap-2 rounded-xl border bg-card px-3 py-2.5 text-left transition-colors outline-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring",
          selected ? "border-primary/50 ring-1 ring-primary/30" : "border-border",
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Bot aria-hidden className="size-3" />
          </span>
          <span className="min-w-0 truncate font-mono text-[13px] font-medium">{step.key ?? step.label ?? `agent ${step.seq}`}</span>
          <span className="text-xs text-muted-foreground">{step.phase}</span>
          <span className="flex-1" />
          {running ? <StatusPill tone="running" pulse size="sm" label="Working" /> : step.status === "failed" ? <StatusPill tone="danger" size="sm" label="Failed" /> : null}
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {running ? <Elapsed since={step.startedAt} /> : step.endedAt ? <Duration ms={step.endedAt - step.startedAt} /> : null}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
          {step.route?.model ? <span>{step.route.model}</span> : null}
          {step.route?.effort ? <span>effort {step.route.effort}</span> : null}
          {step.usage ? <span className="tabular-nums">{formatTokens(step.usage.input + step.usage.output)}</span> : null}
          {step.usage?.usd !== undefined ? <span className="tabular-nums">{formatUsd(step.usage.usd)}</span> : null}
          {out.diffStats ? (
            <span className="tabular-nums">
              <span className="text-status-success-fg">+{out.diffStats.adds}</span> <span className="text-status-danger-fg">−{out.diffStats.dels}</span> in {plural(out.diffStats.files, "file")}
            </span>
          ) : null}
        </div>
        {running && step.label && step.label !== step.key ? <p className="font-mono text-xs text-status-running-fg">{step.label}</p> : null}
        {out.summary ? <p className="text-[13px] leading-relaxed text-foreground">{out.summary}</p> : null}
        {out.files?.length ? (
          <ul className="flex flex-wrap gap-1">
            {out.files.map((f) => (
              <li key={f.path} className="inline-flex h-5 max-w-full items-center gap-1 rounded-md bg-muted px-1.5 font-mono text-[11px] text-muted-foreground">
                <span className="truncate">{f.path}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </button>
    </li>
  );
}

export function AgentLogPanel({ run, seq, onSelect, projectId, paneRef }: { run: RunDetail; seq?: number; onSelect: (seq: number) => void; projectId: string; paneRef?: Ref<HTMLElement> }) {
  const agents = run.steps.filter((s) => s.kind === "agent");
  return (
    <div className="space-y-5">
      <section aria-label="Agent steps" className="space-y-2">
        <h3 className="text-[13px] font-medium">
          Agent steps <span className="font-normal text-muted-foreground tabular-nums">· {agents.length}</span>
        </h3>
        {agents.length ? (
          <ol className="space-y-2">
            {agents.map((s) => (
              <AgentStepCard key={s.seq} step={s} selected={s.seq === seq} onSelect={() => onSelect(s.seq)} />
            ))}
          </ol>
        ) : (
          <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[13px] text-muted-foreground">No agent step has started yet.</p>
        )}
      </section>
      <section ref={paneRef} aria-label="Selected step" className="scroll-mt-20 space-y-2 rounded-2xl border border-border p-4">
        {seq !== undefined ? <StepPane run={run} seq={seq} projectId={projectId} /> : <p className="text-[13px] text-muted-foreground">Pick a step in the run ledger to inspect it.</p>}
      </section>
    </div>
  );
}

/** "T-7: <text>": an Implementation stage note that names the task, so it lists here and reaches its next dev-task run. */
function AddTaskNote({ projectId, task }: { projectId: string; task: DeliveryTask }) {
  const [text, setText] = useState("");
  const add = useAddNote(projectId);
  const id = useId();
  const prefix = `${task.id}: `;
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    const named = new RegExp(`^\\s*${task.id.replace("-", "\\-")}\\b`).test(t);
    add.mutate({ stage: "implementation", text: named ? t : `${prefix}${t}` }, { onSuccess: () => setText("") });
  };
  return (
    <section aria-label="Add a note" className="space-y-2 rounded-xl border border-border p-3">
      <label htmlFor={id} className="flex flex-wrap items-baseline gap-x-2 text-xs font-medium">
        Add a note about {task.id}
        <span className="font-normal text-muted-foreground">Saved as an Implementation note that starts with {task.id}; the next dev-task run for this task receives it.</span>
      </label>
      <div className="flex min-w-0 items-start gap-2 rounded-lg border border-input bg-transparent pl-3 focus-within:ring-2 focus-within:ring-ring">
        <span aria-hidden className="shrink-0 pt-2 font-mono text-[13px] text-muted-foreground">
          {prefix.trim()}
        </span>
        <Textarea
          id={id}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={add.isPending}
          placeholder="e.g. Reuse the existing date helper instead of adding a new one."
          className="min-h-0 border-0 px-0 shadow-none focus-visible:ring-0"
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <span className="text-[11px] text-muted-foreground">Ctrl+Enter to add</span>
        <Button size="sm" className="rounded-full" disabled={!text.trim() || add.isPending} onClick={submit}>
          {add.isPending ? <Spinner aria-hidden /> : null}
          Add note
        </Button>
      </div>
    </section>
  );
}

export function TaskNotesPanel({ projectId, task, bundle }: { projectId: string; task: DeliveryTask; bundle: ProjectBundle }) {
  const ids = [task.id, task.jiraKey].filter((x): x is string => !!x);
  const mentions = (text: string) => ids.some((id) => new RegExp(`\\b${id.replace("-", "\\-")}\\b`).test(text));
  const notes = [...bundle.project.stages.implementation.notes, ...bundle.project.stages.qa.notes].filter((n) => mentions(n.text));
  const activity = bundle.activity.filter((a) => a.taskId === task.id).sort((a, b) => b.at - a.at);
  const reviews = [
    task.devReview ? { who: "Developer review", d: task.devReview } : null,
    task.qa.review ? { who: "QA review", d: task.qa.review } : null,
  ].filter((x): x is { who: string; d: NonNullable<DeliveryTask["devReview"]> } => !!x);

  const empty = !task.lastFeedback && reviews.length === 0 && task.qa.bugs.length === 0 && notes.length === 0 && activity.length === 0;

  return (
    <div className="space-y-5">
      {bundle.project.done ? null : <AddTaskNote projectId={projectId} task={task} />}
      {empty ? (
        <p className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-5 text-center text-[13px] text-muted-foreground">
          <MessageSquareText aria-hidden className="size-4 shrink-0" />
          No notes on this task yet. Review feedback, QA bugs and notes that mention {task.id} collect here.
        </p>
      ) : null}
      {task.lastFeedback ? (
        <section aria-label="Latest feedback" className="space-y-1.5 rounded-xl bg-status-attention-bg px-4 py-3">
          <h3 className="text-xs font-medium text-status-attention-fg">Latest rework feedback{task.reworkFrom === "qa" ? " (from QA)" : ""}</h3>
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{task.lastFeedback}</p>
        </section>
      ) : null}

      {reviews.length || task.qa.bugs.length ? (
        <section aria-label="Decisions" className="space-y-2">
          <h3 className="text-[13px] font-medium">Decisions</h3>
          <ul className="space-y-1.5">
            {reviews.map(({ who, d }) => {
              const meta = decisionMeta(d.decision);
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border px-3 py-2 text-[13px]">
                  <span className="font-medium">{who}</span>
                  <StatusPill {...meta} size="sm" />
                  <span className="text-muted-foreground">
                    by {actorText(d.by)} · <RelativeTime at={d.at} />
                  </span>
                  {d.comment ? <p className="basis-full text-muted-foreground">&ldquo;{d.comment}&rdquo;</p> : null}
                </li>
              );
            })}
            {task.qa.bugs.map((b) => (
              <li key={b} className="rounded-xl border border-status-danger-fg/30 bg-status-danger-bg px-3 py-2 text-[13px] text-status-danger-fg">
                Bug: {b}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {notes.length ? (
        <section aria-label="Developer notes" className="space-y-2">
          <h3 className="text-[13px] font-medium">Notes that mention {task.id}</h3>
          <ul className="space-y-1.5">
            {notes.map((n) => (
              <li key={n.id} className="rounded-xl border border-border px-3 py-2 text-[13px]">
                <p className="leading-relaxed">{n.text}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {actorText(n.by)} · <RelativeTime at={n.at} />
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {activity.length ? (
        <section aria-label="Task activity" className="space-y-2">
          <h3 className="text-[13px] font-medium">Activity</h3>
          <ol className="space-y-0.5">
            {activity.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 px-1 py-1 text-[13px]">
                <span className="min-w-0 flex-1">{a.text}</span>
                <span className="text-[11px] text-muted-foreground">
                  {actorText(a.actor)} · <RelativeTime at={a.at} />
                </span>
                {a.runId ? (
                  <Link href={`/runs/${a.runId}`} className="inline-flex items-center gap-0.5 font-mono text-[11px] text-primary hover:underline">
                    {a.runId}
                    <ArrowUpRight aria-hidden className="size-3" />
                  </Link>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
