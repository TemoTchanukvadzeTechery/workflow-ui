"use client";

/**
 * /runs/[runId]: the weft run page in our visual system. Header, tabs (empty ones hidden), and
 * the Steps tab's 352px phase-grouped ledger beside the StepPane. Live via SSE invalidation of
 * ["weft","run",runId]; elapsed times tick on their own.
 */
import { SearchX } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CardSkeleton, EmptyState, ErrorState, SectionCard, SegmentedControl } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { useRun, useRunArtifacts, useRunReport } from "@/lib/api/queries";
import type { RunDetail } from "@/lib/weft/types";
import { defaultSeq, findEntry, pendingHumans } from "./ledger-model";
import { RunHeader } from "./run-header";
import { RunLedger } from "./run-ledger";
import { ArtifactsPanel, ChangesPanel, ChecksPanel, IoPanel, NotesPanel, ReportPanel, RequestsPanel, notesCount, requestsOf } from "./run-panels";
import { StepPane } from "./step-pane";
import { useRunIndexFor } from "./use-run-index";

export type RunTab = "steps" | "requests" | "checks" | "notes" | "artifacts" | "changes" | "report" | "io";
export const RUN_TABS: readonly RunTab[] = ["steps", "requests", "checks", "notes", "artifacts", "changes", "report", "io"];

const TAB_LABEL: Record<RunTab, string> = {
  steps: "Steps",
  requests: "Requests",
  checks: "Checks",
  notes: "Notes",
  artifacts: "Artifacts",
  changes: "Changes",
  report: "Report",
  io: "Input/Output",
};

export interface RunInspectorProps {
  runId: string;
  tab?: RunTab;
  seq?: number;
  onNavigate: (next: { tab?: RunTab; seq?: number }) => void;
}

export function RunInspector({ runId, tab, seq, onNavigate }: RunInspectorProps) {
  const q = useRun(runId);
  if (q.isPending) return <InspectorSkeleton />;
  if (q.error) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <SectionCard>
        {notFound ? (
          <EmptyState
            icon={SearchX}
            title={`No run ${runId}`}
            body="weft has no journal for this run id. It may belong to data that was reset."
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href="/runs">All runs</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState title={`Could not load run ${runId}`} error={q.error} onRetry={() => void q.refetch()} />
        )}
      </SectionCard>
    );
  }
  return <Loaded run={q.data} tab={tab} seq={seq} onNavigate={onNavigate} />;
}

function Loaded({ run, tab, seq, onNavigate }: { run: RunDetail; tab?: RunTab; seq?: number; onNavigate: RunInspectorProps["onNavigate"] }) {
  const indexQ = useRunIndexFor([run.runId]);
  const entry = indexQ.data?.[run.runId];
  const artifacts = useRunArtifacts(run.runId);
  const report = useRunReport(run.runId);
  const [showGates, setShowGates] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);
  const ledgerRef = useRef<HTMLDivElement>(null);

  const counts: Record<RunTab, number | null> = {
    steps: run.steps.length,
    requests: requestsOf(run).length,
    checks: run.checks.length,
    notes: notesCount(run),
    artifacts: artifacts.data?.length ?? 0,
    changes: run.patches.captured.length,
    report: report.data?.trim() ? null : 0,
    io: null,
  };
  const visible = RUN_TABS.filter((t) => t === "steps" || t === "io" || counts[t] !== 0);
  const active: RunTab = tab && visible.includes(tab) ? tab : "steps";

  const selected = seq !== undefined && findEntry(run, seq) ? seq : defaultSeq(run);
  const selectedIsGate = selected !== undefined && run.humans.some((h) => h.seq === selected && h.kind === "gate" && h.answeredBy === "policy");
  const gatesOn = showGates || selectedIsGate;

  // Keep the selected row visible inside the ledger's own scroll box (it is 50vh tall on phones),
  // without moving the page.
  useEffect(() => {
    const box = ledgerRef.current;
    const row = selected === undefined ? null : box?.querySelector<HTMLElement>(`[data-seq="${selected}"]`);
    if (!box || !row) return;
    const b = box.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) box.scrollTop += r.top - b.top - (b.height - r.height) / 2;
  }, [selected, active, gatesOn]);

  const select = (s: number) => {
    onNavigate({ tab: "steps", seq: s });
    // Stacked layout: bring the pane into view when it sits below the fold.
    requestAnimationFrame(() => {
      const el = paneRef.current;
      if (el && el.getBoundingClientRect().top > window.innerHeight * 0.7) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <RunHeader run={run} entry={entry} onOpenRequest={(h) => select(h.seq)} />

      <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        <SegmentedControl<RunTab>
          role="tablist"
          aria-label="Run views"
          value={active}
          onValueChange={(t) => onNavigate({ tab: t, seq: t === "steps" ? seq : undefined })}
          items={visible.map((t) => {
            const waiting = t === "requests" ? pendingHumans(run).length : 0;
            return {
              value: t,
              id: `run-tab-${t}`,
              controls: `run-panel-${t}`,
              label: TAB_LABEL[t],
              count: waiting || counts[t] || undefined,
              countTone: waiting ? ("attention" as const) : undefined,
              ariaLabel: waiting ? `${TAB_LABEL[t]}, ${waiting} waiting` : undefined,
            };
          })}
        />
      </div>

      <div role="tabpanel" id={`run-panel-${active}`} aria-labelledby={`run-tab-${active}`} className="min-w-0">
        {active === "steps" ? (
          <div className="@container min-w-0">
            <div className="grid min-w-0 grid-cols-1 gap-4 @3xl:grid-cols-[352px_minmax(0,1fr)]">
              <SectionCard flush density="dense" className="@3xl:sticky @3xl:top-16 @3xl:self-start">
                <div ref={ledgerRef} className="relative max-h-[50vh] overflow-y-auto overscroll-contain @3xl:max-h-[calc(100vh-6rem)]">
                  <RunLedger run={run} selectedSeq={selected} onSelect={select} showGates={gatesOn} onShowGatesChange={setShowGates} />
                </div>
              </SectionCard>
              <div ref={paneRef} className="scroll-mt-16">
                <SectionCard density="dense" bodyClassName="pt-5 sm:px-6 sm:pb-6">
                  {selected === undefined ? (
                    <EmptyState size="sm" title="This run has not opened a step yet." body="Steps appear here as the workflow schedules them." />
                  ) : (
                    <StepPane key={selected} run={run} seq={selected} projectId={entry?.projectId} onAnswered={() => onNavigate({ tab: "steps", seq: undefined })} />
                  )}
                </SectionCard>
              </div>
            </div>
          </div>
        ) : active === "requests" ? (
          <RequestsPanel run={run} projectId={entry?.projectId} onOpenStep={select} />
        ) : active === "checks" ? (
          <ChecksPanel run={run} />
        ) : active === "notes" ? (
          <NotesPanel run={run} />
        ) : active === "artifacts" ? (
          <ArtifactsPanel run={run} onOpenStep={select} onOpenChanges={() => onNavigate({ tab: "changes" })} />
        ) : active === "changes" ? (
          <ChangesPanel run={run} />
        ) : active === "report" ? (
          <ReportPanel run={run} />
        ) : (
          <IoPanel run={run} />
        )}
      </div>
    </div>
  );
}

function InspectorSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading run">
      <Skeleton className="h-7 w-20 rounded-full" />
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
      <Skeleton className="h-4 w-80" />
      <div className="flex gap-4 border-b pb-2">
        {[48, 64, 56, 72].map((w, i) => (
          <Skeleton key={i} className="h-5" style={{ width: w }} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[352px_1fr]">
        <CardSkeleton rows={10} />
        <CardSkeleton rows={6} />
      </div>
    </div>
  );
}
