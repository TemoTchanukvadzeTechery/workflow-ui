"use client";

/**
 * The non-Steps tabs of the run inspector: Requests, Checks, Notes, Artifacts, Changes, Report,
 * Input/Output. Each takes the RunDetail (plus its own query where the data lives elsewhere).
 */
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleX,
  ExternalLink,
  Eye,
  FileCode2,
  FileText,
  FlaskConical,
  GitCommitHorizontal,
  Lightbulb,
  ListChecks,
  MessageSquareQuote,
  ScrollText,
  ShieldAlert,
  Terminal,
  UserRound,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { EmptyState, ErrorState, FactCell, FactStrip, RelativeTime, StatusPill } from "@/components/common";
import { Markdown, TextDiff } from "@/components/docs";
import { AnswerSummary, HumanRequestCard } from "@/components/hitl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useBlobText, useRunArtifacts, useRunPatch, useRunReport } from "@/lib/api/queries";
import { formatBytes, plural } from "@/lib/format";
import { humanKindMeta } from "@/lib/weft/labels";
import { cn } from "@/lib/utils";
import type { ArtifactEntry, CheckEvidence, CheckState, HumanState, RunDetail, RunNote } from "@/lib/weft/types";
import { DataPane, looksLikeMarkdown } from "./data-pane";
import { isPolicyGate, policyGates } from "./ledger-model";

function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-2xl" />
      ))}
    </div>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("card-surface min-w-0 rounded-[20px] p-5", className)}>{children}</div>;
}

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

export function requestsOf(run: RunDetail): HumanState[] {
  const people = run.humans.filter((h) => !isPolicyGate(h));
  return people.sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || a.seq - b.seq);
}

export function RequestsPanel({ run, projectId, onOpenStep }: { run: RunDetail; projectId?: string; onOpenStep: (seq: number) => void }) {
  const list = requestsOf(run);
  const gates = policyGates(run).length;
  if (list.length === 0) return <EmptyState size="sm" icon={UserRound} title="No requests to people" body="This run has not asked anyone anything." />;
  return (
    <div className="flex max-w-4xl flex-col gap-3">
      {list.map((h) =>
        h.status === "pending" ? (
          <HumanRequestCard key={h.id} runId={run.runId} request={h} workflow={run.workflow} projectId={projectId} />
        ) : (
          <AnsweredRequest key={h.id} h={h} onOpen={() => onOpenStep(h.seq)} />
        ),
      )}
      {gates > 0 && (
        <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <ShieldAlert aria-hidden className="size-3.5" />
          {gates} tool {gates === 1 ? "gate was" : "gates were"} auto-approved by policy and are not listed. Show them in the Steps tab.
        </p>
      )}
    </div>
  );
}

function AnsweredRequest({ h, onOpen }: { h: HumanState; onOpen: () => void }) {
  const kind = humanKindMeta(h.kind);
  const superseded = h.status === "superseded";
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">human.requested · {h.id}</span>
        <span className="inline-flex h-6 items-center rounded-full bg-well px-2 font-mono text-xs">{h.kind}</span>
        {h.key && <span className="inline-flex h-6 items-center rounded-full bg-well px-2 font-mono text-xs">{h.key}</span>}
        {h.phase && <span className="text-xs text-muted-foreground">{h.phase}</span>}
        <span className="flex-1" />
        {superseded ? (
          <StatusPill tone="neutral" label="Superseded" size="sm" />
        ) : (
          <StatusPill tone="success" icon={Check} label={`Answered by ${h.answeredBy ?? "human"}`} size="sm" />
        )}
      </div>
      <p className="text-[15px] leading-6 whitespace-pre-wrap text-heading">{h.question}</p>
      {!superseded && h.answer !== undefined && (
        <div className="rounded-[16px] bg-well p-3">
          <AnswerSummary answer={h.answer} reviewEdit={h.reviewEdit} />
        </div>
      )}
      {h.reviewEdit && (
        <p className="text-xs text-muted-foreground">
          Edited <span className="font-mono text-foreground">{h.reviewEdit.path}</span> in review: a new version was saved with the answer.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {kind.label} asked <RelativeTime at={h.requestedAt} />
        </span>
        <Button variant="ghost" size="sm" onClick={onOpen}>
          Open in steps
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------

export function ChecksPanel({ run }: { run: RunDetail }) {
  if (run.checks.length === 0) return <EmptyState size="sm" icon={ListChecks} title="No checks recorded" />;
  const passed = run.checks.filter((c) => c.status === "pass").length;
  return (
    <div className="flex max-w-4xl flex-col gap-3">
      <p className="text-[13px] text-muted-foreground">
        {passed} of {plural(run.checks.length, "check")} passed. A failed check followed by a passing retry shows both results, as weft records them.
      </p>
      {run.checks.map((c, i) => (
        <CheckCard key={`${c.name}:${i}`} c={c} />
      ))}
    </div>
  );
}

function CheckCard({ c }: { c: CheckState }) {
  const [open, setOpen] = useState(c.status === "fail");
  const pass = c.status === "pass";
  return (
    <Card className={cn("flex flex-col gap-2", !pass && "ring-1 ring-status-danger-fg/25")}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={pass ? "success" : "danger"} icon={pass ? Check : CircleX} label={pass ? "Pass" : "Fail"} size="sm" />
        <span className="font-mono text-[13px] font-medium text-heading">{c.name}</span>
        <span className="inline-flex h-6 items-center rounded-full bg-well px-2 font-mono text-xs text-muted-foreground">{c.disposition}</span>
        {c.required ? <span className="text-xs text-muted-foreground">required</span> : <span className="text-xs text-muted-foreground">optional</span>}
        <span className="flex-1" />
        {(c.details?.length ?? 0) > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Hide evidence" : `Evidence (${c.details!.length})`}
          </Button>
        )}
      </div>
      {c.summary && <p className="text-[13px] leading-5 text-foreground">{c.summary}</p>}
      {c.evidence && (
        <p className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <Terminal aria-hidden className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{c.evidence}</span>
        </p>
      )}
      {open && c.details && (
        <ul className="flex flex-col gap-2 pt-1">
          {c.details.map((d, i) => (
            <li key={i}>
              <EvidenceItem d={d} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EvidenceItem({ d }: { d: CheckEvidence }) {
  switch (d.kind) {
    case "command":
      return (
        <div className="overflow-hidden rounded-[14px] bg-field shadow-[0_0_0_1px_var(--rule)]">
          <div className="flex h-9 items-center gap-2 border-b border-rule px-3.5 text-xs text-muted-foreground">
            <Terminal aria-hidden className="size-3" /> command output
            <span className={cn("ml-auto font-mono", d.exitCode === 0 ? "text-status-success-fg" : "text-status-danger-fg")}>exit {d.exitCode}</span>
          </div>
          {d.output && <pre className="relative max-h-72 overflow-auto p-3 font-mono text-xs leading-5 whitespace-pre-wrap">{d.output}</pre>}
        </div>
      );
    case "file":
      return (
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 rounded-[14px] bg-well px-3.5 py-2.5 text-[13px]">
          <FileCode2 aria-hidden className="size-3.5 self-center text-muted-foreground" />
          <span className="font-mono break-all text-foreground">
            {d.path}
            {d.line ? `:${d.line}` : ""}
          </span>
          {d.message && <span className="text-muted-foreground">{d.message}</span>}
        </p>
      );
    case "metric":
      return (
        <p className="rounded-[14px] bg-well px-3.5 py-2.5 font-mono text-xs">
          {d.name}: <span className="text-foreground">{d.actual}</span>
          {d.unit ? ` ${d.unit}` : ""}
          {d.expected !== undefined ? <span className="text-muted-foreground"> (expected {d.expected})</span> : null}
        </p>
      );
    case "artifact":
      return (
        <p className="rounded-[14px] bg-well px-3.5 py-2.5 text-[13px]">
          Artifact <span className="font-mono">{d.label ?? d.ref.slice(0, 12)}</span>
        </p>
      );
    default:
      return <p className="rounded-[14px] bg-well px-3.5 py-2.5 text-sm whitespace-pre-wrap">{d.text}</p>;
  }
}

// ---------------------------------------------------------------------------------------------
// Notes (weft FindingsTab): decisions, claims, risks, plus log lines and drops
// ---------------------------------------------------------------------------------------------

const NOTE_META: Record<RunNote["kind"], { label: string; icon: typeof Lightbulb; tone: "review" | "running" | "attention" }> = {
  decision: { label: "Decision", icon: Lightbulb, tone: "review" },
  claim: { label: "Claim", icon: MessageSquareQuote, tone: "running" },
  risk: { label: "Risk", icon: ShieldAlert, tone: "attention" },
};

export function notesCount(run: RunDetail): number {
  return run.notes.length + run.logs.length + run.drops.length;
}

export function NotesPanel({ run }: { run: RunDetail }) {
  if (notesCount(run) === 0) return <EmptyState size="sm" icon={ScrollText} title="No notes" body="The workflow recorded no decisions, claims, risks or log lines." />;
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      {run.notes.length > 0 && (
        <div className="flex flex-col gap-2">
          {run.notes.map((n, i) => {
            const m = NOTE_META[n.kind];
            return (
              <Card key={i} className="flex gap-3">
                <StatusPill tone={m.tone} icon={m.icon} label={m.label} size="sm" className="mt-0.5" />
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-[15px] leading-6 text-heading">{n.text}</p>
                  {n.evidence && <p className="font-mono text-xs break-words text-muted-foreground">evidence: {n.evidence}</p>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {run.logs.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="px-1 text-[15px] font-medium text-heading">Log</h3>
          <pre className="card-surface relative max-h-96 overflow-auto rounded-[20px] p-5 font-mono text-xs leading-5 whitespace-pre-wrap">{run.logs.join("\n")}</pre>
        </section>
      )}
      {run.drops.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="px-1 text-[15px] font-medium text-heading">Dropped</h3>
          <ul className="card-surface flex flex-col gap-1 rounded-[20px] p-5 text-sm">
            {run.drops.map((d, i) => (
              <li key={i}>
                <span className="font-mono text-xs">{d.key ?? (d.seq !== undefined ? `step ${d.seq}` : "step")}</span> <span className="text-muted-foreground">{d.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------------------------

export function ArtifactsPanel({ run, onOpenStep, onOpenChanges }: { run: RunDetail; onOpenStep: (seq: number) => void; onOpenChanges: () => void }) {
  const q = useRunArtifacts(run.runId);
  const [preview, setPreview] = useState<ArtifactEntry | null>(null);
  if (q.isPending) return <PanelSkeleton />;
  if (q.error) return <ErrorState size="sm" title="Could not load artifacts" error={q.error} onRetry={() => void q.refetch()} />;
  const items = q.data;
  if (items.length === 0) return <EmptyState size="sm" icon={FileText} title="No artifacts" body="Patches and review attachments this run produces appear here." />;
  return (
    <div className="flex max-w-4xl flex-col gap-2">
      {items.map((a) => (
        <Card key={`${a.kind}:${a.id}:${a.ref}`} className="flex flex-col gap-2 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {a.kind === "patch" ? <GitCommitHorizontal aria-hidden className="size-4 text-status-success-fg" /> : <FileText aria-hidden className="size-4 text-muted-foreground" />}
            <span className="min-w-0 truncate font-mono text-[13px] font-medium text-heading">{a.gate ? (a.gate.kind === "review" ? `review attachment · ${a.id}` : a.id) : a.id}</span>
            <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-xs font-medium", a.kind === "patch" ? "bg-status-success-bg text-status-success-fg" : "bg-well text-muted-foreground")}>{a.kind}</span>
            {a.size !== null && <span className="font-mono text-xs text-muted-foreground">{formatBytes(a.size)}</span>}
            {!a.available && <span className="text-xs text-status-attention-fg">not available</span>}
            <span className="flex-1" />
            {a.kind === "patch" ? (
              <Button variant="secondary" size="sm" onClick={onOpenChanges}>
                View changes
              </Button>
            ) : (
              <>
                <Button variant="secondary" size="sm" onClick={() => setPreview(a)} disabled={!a.available}>
                  <Eye aria-hidden />
                  Preview
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <a href={`/api/weft/blobs/${a.ref}?as=text`} target="_blank" rel="noreferrer">
                    <ExternalLink aria-hidden />
                    Open
                  </a>
                </Button>
              </>
            )}
          </div>
          {a.gate && <p className="line-clamp-2 text-[13px] text-muted-foreground">{a.gate.question}</p>}
          {a.files && a.files.length > 0 && (
            <p className="line-clamp-2 font-mono text-xs break-all text-muted-foreground">
              {plural(a.files.length, "file")}: {a.files.join(", ")}
            </p>
          )}
          {!a.files && a.preview && <p className="line-clamp-2 font-mono text-xs text-muted-foreground">{a.preview}</p>}
          <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            {a.producedBy && (
              <button type="button" onClick={() => onOpenStep(a.producedBy!.seq)} className="inline-flex items-center gap-1 rounded underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50/50 focus-visible:outline-none">
                from step {a.producedBy.seq} · <span className="font-mono">{a.producedBy.label}</span>
                <ArrowUpRight aria-hidden className="size-3" />
              </button>
            )}
            {a.at && <RelativeTime at={a.at} />}
            <span className="font-mono">{a.ref.slice(0, 12)}</span>
          </div>
        </Card>
      ))}
      <ArtifactDialog artifact={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function ArtifactDialog({ artifact, onClose }: { artifact: ArtifactEntry | null; onClose: () => void }) {
  const q = useBlobText(artifact?.ref);
  const text = q.data ?? "";
  const isDiff = /^diff --git |^--- |^\+\+\+ /m.test(text);
  return (
    <Dialog open={!!artifact} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{artifact?.id}</DialogTitle>
          <DialogDescription>
            {artifact?.gate ? artifact.gate.question : "Blob"} {artifact?.size ? `· ${formatBytes(artifact.size)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="relative min-h-0 flex-1 overflow-auto rounded-[16px] bg-field p-4 shadow-[0_0_0_1px_var(--rule)]">
          {q.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : q.error ? (
            <ErrorState size="sm" title="Could not load the artifact" error={q.error} onRetry={() => void q.refetch()} />
          ) : isDiff ? (
            <TextDiff diffText={text} />
          ) : looksLikeMarkdown(text) ? (
            <Markdown source={text} size="sm" />
          ) : (
            <pre className="font-mono text-xs leading-5 whitespace-pre-wrap">{text}</pre>
          )}
        </div>
        {artifact && (
          <div className="flex justify-end">
            <Button asChild variant="secondary" size="sm">
              <a href={`/api/weft/blobs/${artifact.ref}?as=text`} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden />
                Open raw
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------------------------

export function ChangesPanel({ run }: { run: RunDetail }) {
  const captured = run.patches.captured;
  if (captured.length === 0) return <EmptyState size="sm" icon={FileCode2} title="No code changes" body="This run did not capture any patches." />;
  const merged = new Set(run.patches.merged.map((m) => m.key));
  const discarded = new Set(run.patches.discarded.map((m) => m.key));
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      {run.patches.violations.length > 0 && (
        <div role="alert" className="rounded-[20px] bg-status-danger-bg px-5 py-3.5 text-sm text-status-danger-fg">
          Write-scope violations:{" "}
          {run.patches.violations.map((v) => (
            <span key={v.key} className="font-mono">
              {v.key} ({v.files.join(", ")})
            </span>
          ))}
        </div>
      )}
      {captured.map((p) => (
        <PatchCard key={p.key} runId={run.runId} patchKey={p.key} merged={merged.has(p.key)} discarded={discarded.has(p.key)} />
      ))}
    </div>
  );
}

function PatchCard({ runId, patchKey, merged, discarded }: { runId: string; patchKey: string; merged: boolean; discarded: boolean }) {
  const q = useRunPatch(runId, patchKey);
  const patch = q.data?.patches.find((p) => p.key === patchKey);
  const adds = patch?.stats.reduce((n, s) => n + s.adds, 0) ?? 0;
  const dels = patch?.stats.reduce((n, s) => n + s.dels, 0) ?? 0;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <GitCommitHorizontal aria-hidden className="size-4 text-muted-foreground" />
        <span className="font-mono text-[13px] font-medium text-heading">{patchKey}</span>
        {merged && <StatusPill tone="success" icon={Check} label="Merged" size="sm" />}
        {discarded && <StatusPill tone="neutral" label="Discarded" size="sm" />}
        {!merged && !discarded && <StatusPill tone="review" label="Captured" size="sm" />}
        <span className="flex-1" />
        {patch && (
          <span className="font-mono text-xs">
            {plural(patch.stats.length, "file")} <span className="text-status-success-fg">+{adds}</span> <span className="text-status-danger-fg">-{dels}</span>
          </span>
        )}
      </div>
      {q.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : q.error ? (
        <ErrorState size="sm" title="Could not load the patch" error={q.error} onRetry={() => void q.refetch()} />
      ) : !patch ? (
        <p className="text-[13px] text-muted-foreground">Patch not found.</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-rule rounded-[14px] text-[13px] shadow-[0_0_0_1px_var(--rule)]">
            {patch.stats.map((s) => (
              <li key={s.path} className="flex min-h-10 min-w-0 items-center gap-2 px-3.5 py-2">
                <span className={cn("w-16 shrink-0 text-xs", s.status === "added" ? "text-status-success-fg" : s.status === "deleted" ? "text-status-danger-fg" : "text-muted-foreground")}>{s.status}</span>
                <span className="min-w-0 flex-1 truncate font-mono" title={s.path}>
                  {s.path}
                </span>
                <span className="shrink-0 font-mono tabular-nums">
                  <span className="text-status-success-fg">+{s.adds}</span> <span className="text-status-danger-fg">-{s.dels}</span>
                </span>
              </li>
            ))}
          </ul>
          {patch.outOfScope.length > 0 && <p className="text-xs text-status-attention-fg">Out of write scope: {patch.outOfScope.join(", ")}</p>}
          {patch.diff ? <TextDiff diffText={patch.diff} maxHeightClass="max-h-[70vh]" /> : <p className="text-xs text-muted-foreground">{patch.available ? "No diff text." : "The patch blob is not available."}</p>}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

export function ReportPanel({ run }: { run: RunDetail }) {
  const q = useRunReport(run.runId);
  if (q.isPending) return <PanelSkeleton rows={2} />;
  if (q.error) return <ErrorState size="sm" title="Could not load the report" error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.trim()) return <EmptyState size="sm" icon={FlaskConical} title="No report yet" />;
  return (
    <Card className="max-w-4xl p-5 sm:p-6">
      <Markdown source={q.data} />
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------------------------

export function IoPanel({ run }: { run: RunDetail }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <FactStrip>
        <FactCell label="Workflow" value={run.workflow} mono />
        <FactCell label="Run" value={run.runId} mono />
        {run.defHash && <FactCell label="Definition" value={run.defHash.slice(0, 12)} mono />}
        <FactCell label="Working dir" value={run.cwd} mono />
        {run.baseRef && <FactCell label="Base ref" value={run.baseRef.slice(0, 12)} mono />}
        {run.parentRunId && <FactCell label="Parent run" value={run.parentRunId} mono />}
        <FactCell label="Journal records" value={run.records} numeric />
        {(run.replay.salvaged > 0 || run.replay.diverged > 0) && <FactCell label="Replay" value={`${run.replay.salvaged} salvaged · ${run.replay.diverged} diverged`} mono />}
      </FactStrip>
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <DataPane title="run input" note="as started" value={run.input} />
        <DataPane title="run output" note={run.output === undefined ? "not produced yet" : "as completed"} value={run.output} emptyText="The run has not finished, so there is no output yet." />
      </div>
    </div>
  );
}
