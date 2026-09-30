"use client";

/**
 * The Discovery sub-step of Stage 1 and 2: live run progress, the open dependency review
 * (deps:review:<pass>) answered inline, a summary of every answered pass, and the dependencies
 * the document ends up citing (R1..Rn).
 */
import { SearchCheck, SearchIcon, Telescope } from "lucide-react";
import { EmptyState, SectionCard } from "@/components/common";
import { parseDependencyDetail } from "@/components/hitl";
import type { DocumentArtifact } from "@/lib/delivery/types";
import type { RunDetail } from "@/lib/weft/types";
import { cn } from "@/lib/utils";
import { DependenciesList, type DependencyItem } from "./DependenciesList";
import { InlineRequests } from "./InlineRequests";
import { RunProgress } from "./RunProgress";
import { DISCOVERY_PHASES, DOC_LABEL, passSummaries, runInput, type DocKind, type PassSummary } from "./run-utils";

export interface DiscoveryPanelProps {
  projectId: string;
  kind: DocKind;
  runId?: string;
  run?: RunDetail;
  runPending?: boolean;
  runError?: unknown;
  onRetry?: () => void;
  doc?: DocumentArtifact;
  focus?: string;
  onAnswered?: () => void;
  /** Shown when no run exists yet, e.g. a button back to the intake. */
  emptyAction?: React.ReactNode;
  /** architect-aad: B1 is the BRD path. */
  brdPath?: string;
}

function PassRow({ p }: { p: PassSummary }) {
  const answered = p.status === "answered";
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5 @xl:flex-row @xl:items-start @xl:gap-3">
      <span className="inline-flex h-6 w-fit shrink-0 items-center rounded-full bg-muted px-2.5 text-xs font-medium">Pass {p.pass}</span>
      <div className="min-w-0 flex-1 space-y-1 text-[13px]">
        <p>
          <span className="tabular-nums">{p.found}</span> {p.found === 1 ? "dependency" : "dependencies"} found
          {answered ? (
            <>
              {" · "}
              <span className="inline-flex items-center gap-1 font-medium">
                {p.decision === "search-more" ? <SearchIcon aria-hidden className="size-3.5" /> : <SearchCheck aria-hidden className="size-3.5" />}
                {p.decision === "search-more" ? "Searched more" : "Continued to drafting"}
              </span>
            </>
          ) : p.status === "superseded" ? (
            <span className="text-muted-foreground"> · superseded</span>
          ) : (
            <span className="font-medium text-status-attention-fg"> · waiting on you</span>
          )}
        </p>
        {p.added.length || p.removed.length ? (
          <p className="flex flex-wrap gap-1">
            {p.added.map((r) => (
              <span key={`a-${r}`} className="inline-flex h-5 items-center rounded-md bg-status-success-bg px-1.5 font-mono text-[11px] text-status-success-fg">
                + {r}
              </span>
            ))}
            {p.removed.map((r) => (
              <span key={`r-${r}`} className="inline-flex h-5 items-center rounded-md bg-status-danger-bg px-1.5 font-mono text-[11px] text-status-danger-fg line-through">
                {r}
              </span>
            ))}
          </p>
        ) : null}
        {p.guidance ? <p className="text-xs text-muted-foreground">Guidance: &ldquo;{p.guidance}&rdquo;</p> : null}
      </div>
    </li>
  );
}

/** The list going into drafting, before the run completes and the store records R1..Rn. */
function confirmedFromPasses(passes: PassSummary[]): { items: DependencyItem[]; pass: number } | undefined {
  const last = [...passes].reverse().find((p) => p.status === "answered" && p.decision === "continue");
  if (!last) return undefined;
  const rows = parseDependencyDetail(last.human.detail, last.human.question).filter((r) => !last.removed.includes(r.ref));
  const items: DependencyItem[] = rows.map((r) => ({ ref: r.ref, kind: r.kind, relation: r.relation, title: r.title, why: r.why, ...(r.notFetched ? { note: "content not fetched" } : {}) }));
  for (const ref of last.added) if (!items.some((i) => i.ref === ref)) items.push({ ref, kind: /^\d+$/.test(ref) ? "confluence" : "jira", relation: "added during review", title: ref });
  return { items, pass: last.pass };
}

export function DiscoveryPanel({ projectId, kind, runId, run, runPending, runError, onRetry, doc, focus, onAnswered, emptyAction, brdPath }: DiscoveryPanelProps) {
  const label = DOC_LABEL[kind];
  if (!runId) {
    return (
      <SectionCard density="dense">
        <EmptyState
          icon={Telescope}
          title="Discovery has not started"
          body={`When the ${kind === "brd" ? "requirements" : "architecture"} run starts, the agent searches Jira and Confluence for what the ${label} depends on and asks you to confirm the list.`}
          action={emptyAction}
        />
      </SectionCard>
    );
  }
  const passes = passSummaries(run);
  const recorded = doc?.dependencies ?? [];
  const confirmed = recorded.length === 0 ? confirmedFromPasses(passes) : undefined;
  const discoverOff = runInput(run).discover === false;

  return (
    <div className="space-y-4">
      <RunProgress runId={runId} run={run} isPending={runPending} error={runError} onRetry={onRetry} docLabel={label} ledgerPhases={DISCOVERY_PHASES} />

      <InlineRequests projectId={projectId} runId={runId} run={run} prefix="deps:review:" focus={focus} onAnswered={onAnswered} />

      {discoverOff ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-3 text-[13px] text-muted-foreground">Discovery was turned off for this run (Search Jira &amp; Confluence first: off). Only the seeds and notes you gave are used.</p>
      ) : null}

      {passes.some((p) => p.status !== "pending") ? (
        <SectionCard density="dense" title="Discovery passes" description="Each pass ends with your review; search more runs another pass (up to 3).">
          <ul className={cn("@container divide-y divide-border rounded-xl border border-border")}>
            {passes.map((p) => (
              <PassRow key={p.human.id} p={p} />
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {recorded.length > 0 || confirmed ? (
        <SectionCard
          density="dense"
          title={recorded.length > 0 ? `Dependencies cited in the ${label}` : "Dependencies going into drafting"}
          description={
            recorded.length > 0
              ? `Fetched sources the ${label} cites as R1…R${recorded.length}.${kind === "aad" ? ` The BRD${brdPath ? ` (${brdPath})` : ""} is B1 and architect notes are A1…An.` : " Notes are N1…Nn."}`
              : `Confirmed at pass ${confirmed?.pass}. Only fetched items become R-numbered sources once drafting starts.`
          }
        >
          <DependenciesList items={recorded.length > 0 ? recorded : (confirmed?.items ?? [])} workflow={kind === "aad" ? "architect-aad" : "po-brd"} />
        </SectionCard>
      ) : null}
    </div>
  );
}
