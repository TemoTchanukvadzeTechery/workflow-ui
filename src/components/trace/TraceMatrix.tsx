"use client";

/**
 * Requirement traceability (pattern D.3 #12, Rovo-style AC check): one row per BRD requirement,
 * traced to AAD FRs, epics, tasks and acceptance criteria, with the automated and manual result,
 * the evidence count and a verdict: Met / Missing / Needs manual check / Waived. "Not met only"
 * filters to what still blocks the QA gate; Waive records a reasoned Decision.
 */
import { ChevronDown, CircleCheck, CircleDashed, CircleX, FileSearch, Minus, ShieldOff } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { actorText, EmptyState, RelativeTime, StatusPill } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { DeliveryTask, Epic, Evidence, TraceRow } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { qaStatusMeta, traceVerdictMeta, type TraceVerdict } from "@/lib/weft/labels";
import { WaiveDialog } from "./WaiveDialog";

export interface TraceMatrixProps {
  projectId: string;
  rows: TraceRow[];
  tasks: DeliveryTask[];
  epics: Epic[];
  evidence: Evidence[];
  /** No Waive (stage approved or project done). */
  readOnly?: boolean;
  /** Open a task's evidence (optionally focused on one item). Without it, links go to the task page. */
  onOpenEvidence?: (taskId: string, evidenceId?: string) => void;
  className?: string;
}

const RESULT: Record<TraceRow["automated"], { label: string; icon: typeof CircleCheck; cls: string }> = {
  pass: { label: "Pass", icon: CircleCheck, cls: "text-status-success-fg" },
  fail: { label: "Fail", icon: CircleX, cls: "text-status-danger-fg" },
  none: { label: "None", icon: Minus, cls: "text-muted-foreground" },
};

function ResultCell({ value, label }: { value: TraceRow["automated"]; label: string }) {
  const r = RESULT[value];
  const Icon = r.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", r.cls)}>
      <Icon aria-hidden className="size-3.5" strokeWidth={2.25} />
      <span className="sr-only">{label}: </span>
      {r.label}
    </span>
  );
}

function Chips({ label, items, hrefOf, mono = true }: { label: string; items: Array<{ id: string; text: string }>; hrefOf?: (id: string) => string; mono?: boolean }) {
  if (items.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="kicker">{label}</span>
        <span>none</span>
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      <span className="kicker">{label}</span>
      {items.map((it) =>
        hrefOf ? (
          <Link key={it.id} href={hrefOf(it.id)} className={cn("inline-flex h-5 items-center rounded-md border bg-background px-1.5 text-[11px] text-foreground hover:border-primary/60 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", mono && "font-mono")}>
            {it.text}
          </Link>
        ) : (
          <span key={it.id} className={cn("inline-flex h-5 items-center rounded-md border bg-background px-1.5 text-[11px] text-foreground", mono && "font-mono")}>
            {it.text}
          </span>
        ),
      )}
    </span>
  );
}

function RowDetails({ projectId, row, tasks, evidence, onOpenEvidence }: { projectId: string; row: TraceRow; tasks: DeliveryTask[]; evidence: Evidence[]; onOpenEvidence?: (taskId: string, evidenceId?: string) => void }) {
  const rowTasks = row.taskIds.map((id) => tasks.find((t) => t.id === id)).filter((t): t is DeliveryTask => !!t);
  if (rowTasks.length === 0) return <p className="text-xs text-muted-foreground">No task implements this requirement yet, so nothing can be tested.</p>;
  return (
    <ul className="space-y-2">
      {rowTasks.map((t) => {
        const acIds = row.acIds.filter((a) => a.startsWith(`${t.id}/`)).map((a) => a.slice(t.id.length + 1));
        const acs = t.acceptanceCriteria.filter((ac) => acIds.includes(ac.id));
        const live = evidence.filter((e) => e.taskId === t.id && !e.supersededBy);
        return (
          <li key={t.id} className="rounded-lg border bg-background px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link href={`/projects/${projectId}/tasks/${t.id}`} className="font-mono text-xs font-medium text-primary underline-offset-2 hover:underline">
                {t.jiraKey ?? t.id}
              </Link>
              <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
              <StatusPill {...qaStatusMeta(t.qa.status)} size="sm" />
              {onOpenEvidence ? (
                <Button type="button" variant="ghost" size="xs" className="rounded-full" onClick={() => onOpenEvidence(t.id)}>
                  <FileSearch aria-hidden />
                  Evidence ({live.length})
                </Button>
              ) : (
                <Link href={`/projects/${projectId}/tasks/${t.id}`} className="text-xs text-primary hover:underline">
                  Evidence ({live.length})
                </Link>
              )}
            </div>
            <ol className="mt-1.5 space-y-1">
              {acs.map((ac) => {
                const hits = live.filter((e) => e.criterionResults.some((c) => c.criterionId === ac.id));
                const inconclusive = !ac.met && hits.length > 0 && hits.every((e) => e.criterionResults.find((c) => c.criterionId === ac.id)?.result !== "fail");
                const Icon = ac.met ? CircleCheck : inconclusive ? CircleDashed : CircleX;
                const cls = ac.met ? "text-status-success-fg" : inconclusive ? "text-status-attention-fg" : "text-status-danger-fg";
                const label = ac.met ? "Met" : inconclusive ? "Needs manual check" : "Not met";
                return (
                  <li key={ac.id} className="flex items-start gap-2 text-xs">
                    <Icon aria-hidden className={cn("mt-0.5 size-3.5 shrink-0", cls)} strokeWidth={2.25} />
                    <span className="min-w-0 flex-1">
                      <span className="font-mono">{ac.id}</span> <span className={cn("font-medium", cls)}>{label}</span> <span className="text-muted-foreground">·</span> {ac.text}
                    </span>
                    <span className="flex shrink-0 flex-wrap justify-end gap-1">
                      {hits.slice(0, 4).map((e) =>
                        onOpenEvidence ? (
                          <button key={e.id} type="button" onClick={() => onOpenEvidence(t.id, e.id)} className="rounded bg-muted px-1 font-mono text-[10.5px] hover:bg-primary-soft hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label={`Open evidence ${e.id}: ${e.title}`}>
                            {e.id}
                          </button>
                        ) : (
                          <span key={e.id} className="rounded bg-muted px-1 font-mono text-[10.5px]">
                            {e.id}
                          </span>
                        ),
                      )}
                      {hits.length > 4 ? <span className="text-[10.5px] text-muted-foreground">+{hits.length - 4}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          </li>
        );
      })}
    </ul>
  );
}

const VERDICT_ORDER: TraceVerdict[] = ["met", "missing", "needs_manual_check", "waived"];

export function TraceMatrix({ projectId, rows, tasks, epics, evidence, readOnly, onOpenEvidence, className }: TraceMatrixProps) {
  const [notMetOnly, setNotMetOnly] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [waiving, setWaiving] = useState<TraceRow | null>(null);
  const switchId = useId();
  const shown = notMetOnly ? rows.filter((r) => r.verdict !== "met" && r.verdict !== "waived") : rows;
  const counts = Object.fromEntries(VERDICT_ORDER.map((v) => [v, rows.filter((r) => r.verdict === v).length])) as Record<TraceVerdict, number>;
  const covered = counts.met + counts.waived;
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const taskOf = (id: string) => tasks.find((t) => t.id === id);
  const epicOf = (id: string) => epics.find((e) => e.id === id);

  if (rows.length === 0) {
    return <EmptyState icon={FileSearch} title="No requirements to trace" body="The accepted BRD has no numbered requirements, so there is nothing to certify against." />;
  }

  return (
    <div className={cn("@container/trace min-w-0 space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">
            {covered}/{rows.length}
          </span>{" "}
          requirements met or waived
        </p>
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Verdicts">
          {VERDICT_ORDER.filter((v) => counts[v] > 0).map((v) => (
            <li key={v}>
              <StatusPill {...traceVerdictMeta(v)} size="sm" label={`${counts[v]} ${traceVerdictMeta(v).label.toLowerCase()}`} />
            </li>
          ))}
        </ul>
        <label htmlFor={switchId} className="ml-auto inline-flex items-center gap-2 text-[13px]">
          <Switch id={switchId} checked={notMetOnly} onCheckedChange={setNotMetOnly} />
          Not met only
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <div aria-hidden className="hidden border-b bg-muted/50 px-3 py-2 @3xl/trace:block">
          <div className="grid grid-cols-[minmax(0,1fr)_76px_76px_72px_168px] items-center gap-3 text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
            <span>Requirement · FR · Epics · Tasks · ACs</span>
            <span>Automated</span>
            <span>Manual</span>
            <span className="text-right">
              Evidence
            </span>
            <span>Verdict</span>
          </div>
        </div>
        {shown.length === 0 ? (
          <div className="px-3 py-8">
            <EmptyState size="sm" icon={CircleCheck} title="Every requirement is met or waived" body="Turn off Not met only to see the full matrix." />
          </div>
        ) : null}
        <ul className="divide-y" aria-label="Requirement traceability">
          {shown.map((r) => {
            const isOpen = open.has(r.brRef);
            const canWaive = !readOnly && r.verdict !== "met" && r.verdict !== "waived";
            const detailsId = `trace-${r.brRef}-details`;
            return (
              <li key={r.brRef} aria-label={`${r.brRef}: ${traceVerdictMeta(r.verdict).label}`} className={cn("px-3 py-2.5", r.verdict === "missing" && "bg-status-danger-bg/30")}>
                <div className="grid gap-x-3 gap-y-2 @3xl/trace:grid-cols-[minmax(0,1fr)_76px_76px_72px_168px] @3xl/trace:items-start">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => toggle(r.brRef)}
                        aria-expanded={isOpen}
                        aria-controls={detailsId}
                        aria-label={`${isOpen ? "Hide" : "Show"} acceptance criteria for ${r.brRef}`}
                        className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <ChevronDown aria-hidden className={cn("size-4 transition-transform duration-150", !isOpen && "-rotate-90")} />
                      </button>
                      <p className="min-w-0 text-[13px] leading-snug">
                        <span className="mr-1.5 font-mono text-xs font-semibold">{r.brRef}</span>
                        {r.brText}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 pl-7">
                      <Chips label="FR" items={r.frRefs.map((f) => ({ id: f, text: f }))} />
                      <Chips label="Epics" items={r.epicIds.map((id) => ({ id, text: epicOf(id)?.key ?? id }))} />
                      <Chips label="Tasks" items={r.taskIds.map((id) => ({ id, text: taskOf(id)?.jiraKey ?? id }))} hrefOf={(id) => `/projects/${projectId}/tasks/${id}`} />
                      <span className="inline-flex items-center gap-1 text-[11px]">
                        <span className="kicker">ACs</span>
                        <span className="tabular-nums">{r.acIds.length}</span>
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-7 @3xl/trace:contents">
                    <div className="@3xl/trace:pt-0.5">
                      <span className="mr-1 text-[11px] text-muted-foreground @3xl/trace:hidden">Automated</span>
                      <ResultCell value={r.automated} label="Automated" />
                    </div>
                    <div className="@3xl/trace:pt-0.5">
                      <span className="mr-1 text-[11px] text-muted-foreground @3xl/trace:hidden">Manual</span>
                      <ResultCell value={r.manual} label="Manual" />
                    </div>
                    <div className="@3xl/trace:text-right">
                      <button
                        type="button"
                        onClick={() => (r.taskIds.length === 1 && onOpenEvidence ? onOpenEvidence(r.taskIds[0]) : toggle(r.brRef))}
                        disabled={r.evidenceCount === 0}
                        className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs tabular-nums hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:text-muted-foreground disabled:hover:bg-transparent"
                        aria-label={`${r.evidenceCount} evidence items for ${r.brRef}`}
                      >
                        <FileSearch aria-hidden className="size-3.5 text-muted-foreground" />
                        {r.evidenceCount}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pl-7 @3xl/trace:flex-col @3xl/trace:items-start @3xl/trace:pl-0">
                    <StatusPill {...traceVerdictMeta(r.verdict)} size="sm" />
                    {canWaive ? (
                      <Button type="button" variant="outline" size="xs" className="rounded-full" onClick={() => setWaiving(r)} aria-label={`Waive ${r.brRef}`}>
                        <ShieldOff aria-hidden />
                        Waive
                      </Button>
                    ) : null}
                  </div>
                </div>
                {r.waiver ? (
                  <p className="mt-1.5 pl-7 text-xs text-muted-foreground">
                    Waived by <span className="text-foreground">{actorText(r.waiver.by)}</span> <RelativeTime at={r.waiver.at} />
                    {r.waiver.comment ? <>: &ldquo;{r.waiver.comment}&rdquo;</> : null}
                  </p>
                ) : null}
                {isOpen ? (
                  <div id={detailsId} className="mt-2 pl-7">
                    <RowDetails projectId={projectId} row={r} tasks={tasks} evidence={evidence} onOpenEvidence={onOpenEvidence} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
      <WaiveDialog projectId={projectId} row={waiving} onOpenChange={(o) => !o && setWaiving(null)} />
    </div>
  );
}
