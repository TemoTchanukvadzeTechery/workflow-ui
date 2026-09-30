"use client";

/**
 * The evidence a qa-verify run attached to one task (brief C.4, pattern D.3 #11): tabs for
 * Recordings, Screenshots, Test output, Logs and Data, and a per-AC checklist that maps each
 * acceptance criterion to the items proving it. Clicking an AC filters every tab to it; clicking
 * an evidence id jumps to that item. Superseded items (from an earlier QA run) stay available.
 */
import { CircleCheck, CircleDashed, CircleHelp, CircleX, FileSearch, Filter, X } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState, StatusPill } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AcceptanceCriterion, DeliveryTask, Evidence } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { EvidenceItem } from "./EvidenceItem";
import { DataTab, LogsTab, TestOutputTab } from "./panels";
import { RecordingPlayer } from "./RecordingPlayer";
import { ScreenshotsTab } from "./ScreenshotsTab";
import { acResult, evidenceDomId, evidenceTab, EVIDENCE_TABS, type AcResult, type EvidenceTab } from "./utils";

export interface EvidenceGalleryProps {
  projectId: string;
  task: DeliveryTask;
  /** The project's evidence (or just this task's); items of other tasks are ignored. */
  evidence: Evidence[];
  /** Open on this item (e.g. a link from the trace matrix). */
  focusEvidenceId?: string;
  /** Hide the per-AC checklist (when the page shows acceptance criteria elsewhere). */
  hideChecklist?: boolean;
  className?: string;
}

const AC_STATE: Record<AcResult | "met", { label: string; icon: typeof CircleCheck; cls: string }> = {
  met: { label: "Met", icon: CircleCheck, cls: "text-status-success-fg" },
  pass: { label: "Met", icon: CircleCheck, cls: "text-status-success-fg" },
  fail: { label: "Not met", icon: CircleX, cls: "text-status-danger-fg" },
  inconclusive: { label: "Needs manual check", icon: CircleHelp, cls: "text-status-attention-fg" },
  none: { label: "No evidence", icon: CircleDashed, cls: "text-status-neutral-fg" },
};

function acState(ac: AcceptanceCriterion, live: Evidence[]) {
  const r = acResult(ac, live);
  const key: AcResult | "met" = ac.met ? "met" : r.result === "pass" ? "inconclusive" : r.result;
  return { ...AC_STATE[key], key, items: r.items };
}

function AcChecklist({ task, live, activeAc, onToggleAc, onJump }: { task: DeliveryTask; live: Evidence[]; activeAc: string | null; onToggleAc: (id: string) => void; onJump: (evidenceId: string) => void }) {
  const met = task.acceptanceCriteria.filter((a) => a.met).length;
  return (
    <section aria-label="Acceptance criteria checklist" className="min-w-0 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="kicker">Acceptance criteria</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {met}/{task.acceptanceCriteria.length} met
        </span>
      </div>
      {task.acceptanceCriteria.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">This task has no acceptance criteria.</p>
      ) : (
        <ol className="space-y-1.5">
          {task.acceptanceCriteria.map((ac) => {
            const s = acState(ac, live);
            const Icon = s.icon;
            const on = activeAc === ac.id;
            const uniqueItems = s.items.filter((it, i, a) => a.findIndex((x) => x.e.id === it.e.id) === i);
            return (
              <li key={ac.id} className={cn("rounded-lg border bg-card", on && "border-primary ring-1 ring-primary")}>
                <button
                  type="button"
                  onClick={() => onToggleAc(ac.id)}
                  aria-pressed={on}
                  title={on ? "Show all evidence" : `Show only evidence for ${ac.id}`}
                  className="flex w-full items-start gap-2 rounded-lg px-2.5 pt-2 pb-1 text-left hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", s.cls)} strokeWidth={2.25} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-1.5">
                      <span className="font-mono text-[11px] font-medium">{ac.id}</span>
                      <span className={cn("text-[11px] font-medium", s.cls)}>{s.label}</span>
                    </span>
                    <span className="block text-xs leading-snug text-foreground">{ac.text}</span>
                  </span>
                </button>
                <div className="flex flex-wrap items-center gap-1 px-2.5 pb-2 pl-8">
                  {uniqueItems.length === 0 ? (
                    <span className="text-[11px] text-muted-foreground">No evidence recorded</span>
                  ) : (
                    uniqueItems.map(({ e, result, detail }) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => onJump(e.id)}
                        title={`${e.title}${detail ? ` · ${detail}` : ""}`}
                        aria-label={`Open ${e.id} (${result}): ${e.title}`}
                        className="inline-flex h-5 items-center gap-1 rounded-md bg-muted px-1.5 font-mono text-[10.5px] text-foreground hover:bg-primary-soft hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <span aria-hidden className={cn("size-1.5 rounded-full", result === "pass" ? "bg-status-success-fg" : result === "fail" ? "bg-status-danger-fg" : "bg-status-attention-fg")} />
                        {e.id}
                      </button>
                    ))
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function EvidenceGallery({ task, evidence, focusEvidenceId, hideChecklist, className }: EvidenceGalleryProps) {
  const all = evidence.filter((e) => e.taskId === task.id);
  const live = all.filter((e) => !e.supersededBy);
  const supersededCount = all.length - live.length;
  const focusItem = focusEvidenceId ? all.find((e) => e.id === focusEvidenceId) : undefined;

  const [showSuperseded, setShowSuperseded] = useState(!!focusItem?.supersededBy);
  const [activeAc, setActiveAc] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(focusItem?.id ?? null);
  const pool = showSuperseded ? all : live;
  const visible = activeAc ? pool.filter((e) => e.criterionResults.some((c) => c.criterionId === activeAc)) : pool;
  const byTab = (t: EvidenceTab) => visible.filter((e) => evidenceTab(e) === t);
  const firstTab = EVIDENCE_TABS.find((t) => byTab(t.id).length > 0)?.id ?? "recordings";
  const [tab, setTab] = useState<EvidenceTab>(focusItem ? evidenceTab(focusItem) : firstTab);

  useEffect(() => {
    if (!focusEvidenceId) return;
    const t = window.setTimeout(() => document.getElementById(evidenceDomId(focusEvidenceId))?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
    return () => window.clearTimeout(t);
  }, [focusEvidenceId]);

  const jumpTo = (id: string) => {
    const item = all.find((e) => e.id === id);
    if (!item) return;
    if (item.supersededBy) setShowSuperseded(true);
    if (activeAc && !item.criterionResults.some((c) => c.criterionId === activeAc)) setActiveAc(null);
    setTab(evidenceTab(item));
    setHighlightId(id);
    window.setTimeout(() => document.getElementById(evidenceDomId(id))?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  };

  const toggleAc = (id: string) => {
    const next = activeAc === id ? null : id;
    setActiveAc(next);
    setHighlightId(null);
    if (next) {
      const inTab = pool.some((e) => evidenceTab(e) === tab && e.criterionResults.some((c) => c.criterionId === next));
      if (!inTab) {
        const t = EVIDENCE_TABS.find((x) => pool.some((e) => evidenceTab(e) === x.id && e.criterionResults.some((c) => c.criterionId === next)));
        if (t) setTab(t.id);
      }
    }
  };

  if (all.length === 0) {
    const testing = task.qa.status === "testing";
    return (
      <div className={cn("@container/gallery min-w-0", className)}>
        <EmptyState
          size="sm"
          dashed
          icon={FileSearch}
          title={testing ? "Collecting evidence" : "No evidence yet"}
          body={testing ? "qa-verify is running. Recordings, screenshots and test output appear when its Report step finishes." : "Run the QA agent on this task to record automated and manual evidence against each acceptance criterion."}
        />
      </div>
    );
  }

  const counts = {
    pass: live.filter((e) => e.result === "pass").length,
    fail: live.filter((e) => e.result === "fail").length,
    inconclusive: live.filter((e) => e.result === "inconclusive").length,
    automated: live.filter((e) => e.mode === "automated").length,
    manual: live.filter((e) => e.mode === "manual").length,
  };
  const taskLabel = task.jiraKey ?? task.id;
  const panelProps = { onSelectAc: toggleAc, activeAc, highlightId, onJumpTo: jumpTo };

  return (
    <div className={cn("@container/gallery min-w-0", className)} data-slot="evidence-gallery">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-3">
        <p className="text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{live.length}</span> evidence {live.length === 1 ? "item" : "items"} · {counts.automated} automated, {counts.manual} manual
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {counts.pass ? <StatusPill tone="success" icon={CircleCheck} size="sm" label={`${counts.pass} pass`} /> : null}
          {counts.fail ? <StatusPill tone="danger" icon={CircleX} size="sm" label={`${counts.fail} fail`} /> : null}
          {counts.inconclusive ? <StatusPill tone="attention" icon={CircleHelp} size="sm" label={`${counts.inconclusive} inconclusive`} /> : null}
        </div>
        {supersededCount > 0 ? (
          <label className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={showSuperseded} onCheckedChange={setShowSuperseded} size="sm" />
            Show {supersededCount} superseded
          </label>
        ) : null}
      </div>

      <div className={cn("grid min-w-0 gap-4", !hideChecklist && "@3xl/gallery:grid-cols-[minmax(0,1fr)_280px]")}>
        <div className="min-w-0 space-y-3">
          {activeAc ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-primary-soft px-3 py-1.5 text-xs text-primary">
              <Filter aria-hidden className="size-3.5" />
              <span>
                Showing evidence for <span className="font-mono font-medium">{activeAc}</span> ({visible.length})
              </span>
              <Button type="button" variant="ghost" size="xs" className="ml-auto h-6 rounded-full text-primary hover:text-primary" onClick={() => setActiveAc(null)}>
                <X aria-hidden />
                Clear
              </Button>
            </div>
          ) : null}
          <Tabs value={tab} onValueChange={(v) => setTab(v as EvidenceTab)} className="min-w-0 gap-3">
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <TabsList variant="line" className="h-auto flex-nowrap justify-start gap-1" aria-label="Evidence type">
                {EVIDENCE_TABS.map((t) => {
                  const n = byTab(t.id).length;
                  return (
                    <TabsTrigger key={t.id} value={t.id} className="h-8 flex-none rounded-full px-3 text-[13px] data-active:bg-muted">
                      {t.label}
                      <span className={cn("rounded-full px-1.5 font-mono text-[10.5px] tabular-nums", n ? "bg-background text-foreground" : "text-muted-foreground")}>{n}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>
            {EVIDENCE_TABS.map((t) => {
              const items = byTab(t.id);
              return (
                <TabsContent key={t.id} value={t.id} className="min-w-0">
                  {items.length === 0 ? (
                    <EmptyState size="sm" dashed icon={FileSearch} title={`No ${t.label.toLowerCase()}`} body={activeAc ? `Nothing of this type covers ${activeAc}.` : "The QA agent recorded nothing of this type for this task."} />
                  ) : t.id === "recordings" ? (
                    <div className="space-y-3">
                      {items.map((e) => (
                        <EvidenceItem key={e.id} item={e} highlighted={highlightId === e.id} activeAc={activeAc} onSelectAc={toggleAc} onJumpTo={jumpTo}>
                          <RecordingPlayer item={e} taskLabel={taskLabel} />
                        </EvidenceItem>
                      ))}
                    </div>
                  ) : t.id === "screenshots" ? (
                    <ScreenshotsTab items={items} {...panelProps} />
                  ) : t.id === "tests" ? (
                    <TestOutputTab items={items} {...panelProps} />
                  ) : t.id === "logs" ? (
                    <LogsTab items={items} {...panelProps} />
                  ) : (
                    <DataTab items={items} {...panelProps} />
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        </div>
        {!hideChecklist ? (
          <aside className="min-w-0 @3xl/gallery:sticky @3xl/gallery:top-4 @3xl/gallery:self-start">
            <AcChecklist task={task} live={live} activeAc={activeAc} onToggleAc={toggleAc} onJump={jumpTo} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
