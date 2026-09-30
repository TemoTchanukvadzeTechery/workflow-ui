"use client";

/**
 * The Drafts sub-step of Stage 1 and 2. While a review:<round> request is open, the request card
 * is the document: it shows the draft (editable), the draft report and Accept / Revise, pinned
 * right under the round header. Otherwise the stored document is shown with its versions and
 * diff, plus the last draft report. A run that ended with accepted:false shows the real weft
 * note, "BRD not accepted after N rounds; memory left unchanged".
 */
import { CheckCircle2, CircleAlert, FileClock, FilePen, History, Import } from "lucide-react";
import { useState, type ReactNode } from "react";
import { actorText, EmptyState, FloatingChip, SectionCard, StatusPill, ToolbarGroup, ToolbarText } from "@/components/common";
import { Button } from "@/components/ui/button";
import { DraftReportTabs, TextDiff, versionLabels } from "@/components/docs";
import { Notice, TimeAgo } from "@/components/hitl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useBlobText } from "@/lib/api/queries";
import type { DocumentArtifact, ImportRecord } from "@/lib/delivery/types";
import type { RunDetail } from "@/lib/weft/types";
import { cn } from "@/lib/utils";
import { DocVersionViewer } from "./DocVersionViewer";
import { hasOpenRequest, InlineRequests } from "./InlineRequests";
import { RunProgress } from "./RunProgress";
import { DOC_LABEL, isTerminal, reportMarkdown, reviewRound, runInput, runOutput, type DocKind } from "./run-utils";

export interface DraftsPanelProps {
  projectId: string;
  kind: DocKind;
  doc?: DocumentArtifact;
  runId?: string;
  run?: RunDetail;
  runPending?: boolean;
  runError?: unknown;
  onRetry?: () => void;
  focus?: string;
  onAnswered?: () => void;
  imported?: ImportRecord;
  /** AAD extras (FR trace, acceptance checklist), shown under the review card or the document. */
  extras?: ReactNode;
  /** Action next to the not-accepted banner, e.g. "Start another run". */
  notAcceptedAction?: ReactNode;
  /** A reopened / stale stage: the ReviseNotice (Start another run, Import new version). */
  revise?: ReactNode;
  onCitationClick?: (source: string, part: string, root: HTMLElement | null) => void;
}

/** "BRD not accepted after 3 rounds; memory left unchanged" (the workflow's own note). */
export function NotAcceptedBanner({ kind, run, action, className }: { kind: DocKind; run: RunDetail | undefined; action?: ReactNode; className?: string }) {
  const out = runOutput(run);
  if (!out || out.accepted) return null;
  const note = run?.notes.find((n) => n.kind === "decision" && /not accepted after/.test(n.text))?.text;
  const rounds = out.rounds ?? runInput(run).maxRounds ?? 0;
  return (
    <Notice tone="attention" icon={CircleAlert} role="status" className={className}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1">
          <span className="font-medium">{note ?? `${DOC_LABEL[kind]} not accepted after ${rounds} ${rounds === 1 ? "round" : "rounds"}; memory left unchanged`}</span>
          <span className="mt-0.5 block opacity-90">The run ended at its last review round. Start another run to keep going; the last feedback is carried over as notes.</span>
        </p>
        {action}
      </div>
    </Notice>
  );
}

function VersionCompare({ doc }: { doc: DocumentArtifact }) {
  const labels = versionLabels(doc.versions);
  const sorted = [...doc.versions].sort((a, b) => a.n - b.n);
  const [from, setFrom] = useState(sorted.at(-2)?.n ?? sorted[0]?.n);
  const [to, setTo] = useState(sorted.at(-1)?.n);
  const a = useBlobText(sorted.find((v) => v.n === from)?.blob);
  const b = useBlobText(sorted.find((v) => v.n === to)?.blob);
  const pick = (value: number | undefined, onChange: (n: number) => void, aria: string) => (
    <Select value={value !== undefined ? String(value) : undefined} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger size="sm" aria-label={aria}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {labels.map((l) => (
          <SelectItem key={l.n} value={String(l.n)}>
            <span className="font-medium">{l.label}</span>
            {l.detail ? <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{l.detail}</span> : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <div className="space-y-3">
      <ToolbarGroup aria-label="Versions to compare" className="[&>[data-slot=select-trigger]]:border-0">
        <ToolbarText>Compare</ToolbarText>
        {pick(from, setFrom, "Compare from version")}
        <ToolbarText>with</ToolbarText>
        {pick(to, setTo, "Compare to version")}
      </ToolbarGroup>
      {a.isPending || b.isPending ? <Skeleton className="h-40 w-full" /> : a.data !== undefined && b.data !== undefined ? <TextDiff before={a.data} after={b.data} maxHeightClass="max-h-[60vh]" /> : null}
    </div>
  );
}

export function DocStatusLine({ doc, run, kind, hideRound }: { doc?: DocumentArtifact; run?: RunDetail; kind: DocKind; hideRound?: boolean }) {
  const label = DOC_LABEL[kind];
  const round = reviewRound(run);
  const maxRounds = runInput(run).maxRounds;
  const out = runOutput(run);
  const labels = doc ? versionLabels(doc.versions) : [];
  const last = labels.at(-1);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
      {doc ? <StatusPill status={{ kind: "doc", value: doc.status }} variant="chip" /> : <StatusPill tone="neutral" icon={FileClock} label="No draft yet" variant="chip" />}
      {round && !hideRound && !isTerminal(run?.status) ? <FloatingChip label="Round" value={maxRounds ? `${round} of ${maxRounds}` : String(round)} tone="running" /> : null}
      {last ? <span className="text-muted-foreground">{labels.length} {labels.length === 1 ? "version" : "versions"} · latest {last.label}</span> : null}
      {doc?.status === "accepted" ? (
        <span className="inline-flex flex-wrap items-center gap-1 text-muted-foreground">
          <CheckCircle2 aria-hidden className="size-3.5 text-status-success-fg" />
          Accepted by {doc.acceptedBy ? actorText(doc.acceptedBy) : "someone"}
          {doc.acceptedAt ? (
            <>
              {" · "}
              <TimeAgo at={doc.acceptedAt} />
            </>
          ) : null}
          {out?.rounds ? ` · round ${out.rounds}` : ""}
        </span>
      ) : doc ? (
        <span className="text-muted-foreground">{label} is a draft until you accept it.</span>
      ) : null}
    </div>
  );
}

export function DraftsPanel({ projectId, kind, doc, runId, run, runPending, runError, onRetry, focus, onAnswered, imported, extras, notAcceptedAction, revise, onCitationClick }: DraftsPanelProps) {
  const label = DOC_LABEL[kind];
  const reviewing = hasOpenRequest(run, "review:");
  const drafting = !!run && !isTerminal(run.status) && run.status !== "waiting_for_human" && /^Draft/.test(run.phases.at(-1)?.name ?? "");
  const [showCompare, setShowCompare] = useState(false);
  const report = doc?.lastReport;

  if (!doc && !runId) {
    return (
      <SectionCard density="dense">
        <EmptyState icon={FilePen} title={`No ${label} draft yet`} body={`Start the run from the first step, or import an existing ${label}.`} />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DocStatusLine doc={doc} run={run} kind={kind} hideRound={reviewing} />
        {doc && doc.versions.length > 1 ? (
          <Button type="button" variant="secondary" onClick={() => setShowCompare((s) => !s)} aria-expanded={showCompare}>
            <History aria-hidden />
            {showCompare ? "Hide version compare" : "Compare versions"}
          </Button>
        ) : null}
      </div>

      {imported && (!doc || doc.versions.at(-1)?.source === "import") ? (
        <Notice tone="neutral" icon={Import}>
          Imported {imported.source === "confluence" ? `from Confluence page ${imported.ref}` : "(pasted)"} by {actorText(imported.by)} <TimeAgo at={imported.at} />. The {label} run was skipped; the document is accepted as is.
        </Notice>
      ) : null}

      <NotAcceptedBanner kind={kind} run={run} action={notAcceptedAction} />
      {revise}

      {runId && (drafting || (!doc && !isTerminal(run?.status))) ? (
        <RunProgress runId={runId} run={run} isPending={runPending} error={runError} onRetry={onRetry} docLabel={label} compact />
      ) : null}
      {drafting && doc ? <p className="px-1 text-sm text-muted-foreground">The agent is writing round {reviewRound(run)}. The version below is the one you last reviewed; the new draft appears here when it is ready.</p> : null}

      {showCompare && doc ? (
        <SectionCard density="dense" title="Compare versions">
          <VersionCompare doc={doc} />
        </SectionCard>
      ) : null}

      {reviewing && runId ? (
        <>
          <InlineRequests projectId={projectId} runId={runId} run={run} prefix="review:" focus={focus} onAnswered={onAnswered} />
          {extras}
        </>
      ) : doc ? (
        <>
          <DocVersionViewer projectId={projectId} doc={doc} bodyClassName="max-h-[75vh]" onCitationClick={onCitationClick} />
          {extras}
          {report ? (
            <SectionCard density="dense" title="Draft report" description={`From the last round${doc.status === "accepted" ? ` before the ${label} was accepted` : ""}.`}>
              <DraftReportTabs markdown={reportMarkdown(kind, report)} />
            </SectionCard>
          ) : null}
        </>
      ) : !runPending && run && isTerminal(run.status) ? (
        <SectionCard density="dense">
          <EmptyState icon={FilePen} title={`The run ended before a ${label} draft was written`} body={run.error?.message ?? "Start another run from the first step."} />
        </SectionCard>
      ) : (
        <div className={cn("card-surface space-y-3 rounded-2xl p-5")} aria-busy="true" aria-label={`Waiting for the first ${label} draft`}>
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}
    </div>
  );
}
