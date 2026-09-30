"use client";

/**
 * The Memory sub-step: the open memory:review (Apply / Apply my edited version / Discard) inline,
 * or the result of the update the run made: status, Major/Minor, the changes list with their
 * ChangeKind chips, and stale register entries.
 */
import { BrainCircuit, History, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { EmptyState, SectionCard, StatusPill } from "@/components/common";
import { Markdown } from "@/components/docs";
import { Notice, parseChangeItem } from "@/components/hitl";
import type { DocumentArtifact, ProjectBundle } from "@/lib/delivery/types";
import type { RunDetail } from "@/lib/weft/types";
import { hasOpenRequest, InlineRequests } from "./InlineRequests";
import { RunProgress } from "./RunProgress";
import { DOC_LABEL, isTerminal, runOutput, type DocKind } from "./run-utils";

export interface MemoryPanelProps {
  projectId: string;
  bundle: ProjectBundle;
  kind: DocKind;
  doc?: DocumentArtifact;
  runId?: string;
  run?: RunDetail;
  runPending?: boolean;
  runError?: unknown;
  onRetry?: () => void;
  focus?: string;
  onAnswered?: () => void;
  /** The document was imported, so no run proposed a memory update. */
  imported?: boolean;
}

export function ChangeList({ changes }: { changes: string[] }) {
  if (changes.length === 0) return <p className="rounded-lg bg-muted/50 px-3 py-4 text-center text-[13px] text-muted-foreground">No changes.</p>;
  return (
    <ul className="@container space-y-1.5">
      {changes.map((item, i) => {
        const c = parseChangeItem(item);
        return (
          <li key={i} className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2 @lg:flex-row @lg:items-start @lg:gap-3">
            {c.kind ? <span className="inline-flex h-5 w-fit shrink-0 items-center rounded-full bg-muted px-2 font-mono text-[11px] text-muted-foreground">{c.kind}</span> : null}
            <Markdown source={c.summary} size="sm" className="[&_p]:my-0" />
          </li>
        );
      })}
    </ul>
  );
}

export function MemoryPanel({ projectId, bundle, kind, doc, runId, run, runPending, runError, onRetry, focus, onAnswered, imported }: MemoryPanelProps) {
  const label = DOC_LABEL[kind];
  const memory = doc?.memory ?? runOutput(run)?.memory;
  const memDoc = bundle.documents.find((d) => d.kind === "memory");
  const reviewing = hasOpenRequest(run, "memory:review");
  const running = !!run && !isTerminal(run.status) && !reviewing && /^Update memory/.test(run.phases.at(-1)?.name ?? "");

  return (
    <div className="space-y-4">
      {running && runId ? <RunProgress runId={runId} run={run} isPending={runPending} error={runError} onRetry={onRetry} docLabel={label} compact /> : null}
      {reviewing && runId ? (
        <>
          <p className="text-[13px] text-muted-foreground">
            You accepted the {label}. Before the run finishes (and the {label} is marked accepted), the agent proposes an update to the shared memory, memory/memory.md, so future BRD and AAD runs see what this {label} settled. Nothing is written until you apply it.
          </p>
          <InlineRequests projectId={projectId} runId={runId} run={run} prefix="memory:review" focus={focus} onAnswered={onAnswered} memoryStale={memory?.stale} />
        </>
      ) : memory ? (
        <SectionCard
          density="dense"
          title="Shared memory update"
          description={`From the ${label} run${runId ? ` ${runId}` : ""}. Memory is shared by every BRD and AAD run.`}
          actions={memDoc ? (
            <Link href={`/projects/${encodeURIComponent(projectId)}/docs/${encodeURIComponent(memDoc.id)}`} className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <History aria-hidden className="size-3.5" />
              Open memory
            </Link>
          ) : null}
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={{ kind: "memory", value: memory.status }} />
              {memory.status !== "skipped" && memory.status !== "unchanged" ? <StatusPill tone={memory.major ? "attention" : "neutral"} icon={null} label={memory.major ? "Major update" : "Minor update"} /> : null}
              <span className="text-xs text-muted-foreground">
                {memory.status === "updated"
                  ? "Applied: future runs read it."
                  : memory.status === "discarded"
                    ? "Discarded: memory/memory.md is unchanged. The stage gate notes it."
                    : memory.status === "skipped"
                      ? `Skipped because the ${label} was not accepted.`
                      : `The memory already records this version of the ${label}.`}
              </span>
            </div>
            {memory.stale.length > 0 ? (
              <Notice tone="attention" icon={TriangleAlert}>
                <p className="font-medium">Recorded documents changed since memory was written</p>
                <ul className="mt-1 list-disc pl-4 text-xs">
                  {memory.stale.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            {memory.changes.length > 0 ? (
              <div className="space-y-1.5">
                <h4 className="text-xs font-medium text-muted-foreground">Changes ({memory.changes.length})</h4>
                <ChangeList changes={memory.changes} />
              </div>
            ) : null}
          </div>
        </SectionCard>
      ) : (
        <SectionCard density="dense">
          <EmptyState
            icon={BrainCircuit}
            title={imported && !runId ? "No memory update for an imported document" : "No memory update yet"}
            body={
              imported && !runId
                ? `The ${label} was imported, so no run proposed an update to the shared memory (memory/memory.md). The memory changes only through a run's memory review, so future runs do not see what this ${label} settled until one records it.`
                : `After you accept the ${label}, the agent proposes an update to the shared memory for you to apply or discard.`
            }
          />
        </SectionCard>
      )}
    </div>
  );
}
