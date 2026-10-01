"use client";

/**
 * Home's memory card (plan §3), a full-width compact row between attention/activity and the
 * projects table. Three zones: the score (a 104px ring, the band, how many checks pass, when they
 * ran); the top three issues as deep links into the Health tab (failures first, then the most
 * points lost); and the vault's key figures with the last edit and the last commit. States:
 * pending → skeleton; 503 → a neutral "Memory workspace not found" with the env hint; any other
 * error → ErrorState with retry; index building → a caption. Not part of the Insights rotation.
 */
import { CircleCheck, CircleMinus, FolderSearch, Loader2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState, ErrorState, IdChip, RelativeTime, SectionCard, StatusPill } from "@/components/common";
import { checkAnchor, formatPoints, HEALTH_BAND_META, HEALTH_CHECK_META, HEALTH_STATUS_META, pointsLost, topHealthIssues } from "@/components/memory/health/check-meta";
import { ScoreRing } from "@/components/memory/health/score-ring";
import { memoryViewHref } from "@/components/memory/use-memory-view";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { useMemoryHealth } from "@/lib/api/queries";
import { formatNumber, plural } from "@/lib/format";
import type { MemoryHealthPayload } from "@/lib/memory/types";
import { cn } from "@/lib/utils";
import { CardMenu } from "./CardMenu";

const HEALTH_HREF = memoryViewHref("health");

/** A zone's small caption (13px muted). */
function ZoneLabel({ children }: { children: ReactNode }) {
  return <h3 className="text-[13px] leading-5 font-normal text-muted-foreground">{children}</h3>;
}

function Figure({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="truncate text-[13px] leading-5 text-muted-foreground">{label}</dt>
      <dd className={cn("text-[26px] leading-none font-normal tracking-[-0.02em] tabular-nums", value === null || value === 0 ? "text-muted-numeral" : "text-heading")}>
        {value === null ? "–" : formatNumber(value)}
      </dd>
    </div>
  );
}

function ScoreZone({ health }: { health: MemoryHealthPayload }) {
  const band = health.band ? HEALTH_BAND_META[health.band] : null;
  return (
    <div className="flex items-center gap-5">
      <ScoreRing score={health.score} band={health.band} size={104} />
      <div className="flex min-w-0 flex-col gap-2">
        {band ? <StatusPill tone={band.tone} icon={band.icon} label={band.label} /> : <StatusPill tone="neutral" icon={CircleMinus} label="Not scored yet" />}
        <p className="text-[15px] leading-5 text-heading">
          {health.counts.pass} of {plural(health.checks.length, "check")} pass
        </p>
        <p className="text-[13px] leading-5 text-muted-foreground">
          Checked <RelativeTime at={health.checkedAt} />
        </p>
      </div>
    </div>
  );
}

function IssuesZone({ health }: { health: MemoryHealthPayload }) {
  const issues = topHealthIssues(health.checks, 3);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ZoneLabel>Top issues</ZoneLabel>
      {issues.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-heading">
          <CircleCheck aria-hidden className="size-4 shrink-0 text-status-success-fg" strokeWidth={2} />
          {health.counts.pass > 0 ? "Every check that ran passes." : "No checks have run yet."}
        </p>
      ) : (
        <ul className="-mx-2.5 flex flex-col">
          {issues.map((check) => {
            const meta = HEALTH_CHECK_META[check.id];
            const status = HEALTH_STATUS_META[check.status];
            return (
              <li key={check.id}>
                <Link
                  href={memoryViewHref("health", checkAnchor(check.id))}
                  className="flex min-w-0 items-center gap-3 rounded-[14px] px-2.5 py-2 outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <StatusPill size="sm" tone={status.tone} icon={status.icon} label={status.label} className="shrink-0" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm leading-5 font-medium text-heading">{meta.label}</span>
                    <span className="truncate text-[13px] leading-5 text-muted-foreground">{check.measure.summary}</span>
                  </span>
                  <span className="shrink-0 text-[13px] leading-5 text-muted-foreground tabular-nums">
                    −{formatPoints(pointsLost(check))}
                    <span className="sr-only"> points</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FiguresZone({ health }: { health: MemoryHealthPayload }) {
  const { vault } = health;
  // Claims and connections come from the snapshot, which is not read until the index exists.
  const fromSnapshot = health.index.state === "ready" && !health.errors.some((e) => e.source === "snapshot");
  const commit = vault.lastCommit;
  return (
    // Its own container: four figures in a row only when this zone (not the card) has the room.
    <div className="@container flex min-w-0 flex-col gap-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 @sm:grid-cols-4">
        <Figure label="Notes" value={vault.notes} />
        <Figure label="Connections" value={fromSnapshot ? vault.edges : null} />
        <Figure label="Claims" value={fromSnapshot ? vault.claims : null} />
        <Figure label="Uncommitted" value={vault.uncommitted} />
      </dl>
      <div className="flex flex-col gap-1.5 text-[13px] leading-5 text-muted-foreground">
        {vault.lastChange ? (
          <p className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0">Last edit</span>
            <span aria-hidden>·</span>
            <Link
              href={`/memory/${vault.lastChange.id}`}
              className="min-w-0 truncate rounded-[4px] font-medium text-heading underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {vault.lastChange.title ?? vault.lastChange.id}
            </Link>
            <RelativeTime at={vault.lastChange.at} className="shrink-0" />
          </p>
        ) : null}
        {commit ? (
          <p className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0">Last commit</span>
            <IdChip id={commit.shortSha} size="sm" className="shrink-0" />
            <span className="min-w-0 truncate text-heading" title={commit.subject}>
              {commit.subject}
            </span>
            <RelativeTime at={Date.parse(commit.at)} className="shrink-0" />
          </p>
        ) : health.git.ok ? (
          <p>No commits touch the vault yet.</p>
        ) : (
          <p>{health.git.reason === "not-a-repo" ? "The workspace is not a git repository." : "git is unavailable."}</p>
        )}
      </div>
    </div>
  );
}

function CardSkeletonBody() {
  return (
    <div aria-busy="true" aria-label="Checking the memory vault" className="grid gap-6 @2xl:grid-cols-2 @5xl:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] @5xl:gap-10">
      <div className="flex items-center gap-5">
        <Skeleton className="size-[104px] rounded-full" />
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-7 w-20 rounded-full" />
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3.5 w-20" />
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3.5 w-1/2" />
      </div>
    </div>
  );
}

export function MemoryHealthCard({ className }: { className?: string }) {
  const q = useMemoryHealth();
  const health = q.data;
  const missing = q.error instanceof ApiError && q.error.status === 503;

  return (
    <SectionCard title="Memory health" cardMenu={<CardMenu href={HEALTH_HREF} label="Open memory health" />} className={cn("@container", className)}>
      {q.isPending ? (
        <CardSkeletonBody />
      ) : missing ? (
        <EmptyState
          size="sm"
          icon={FolderSearch}
          title="Memory workspace not found"
          body={
            <>
              Point <code className="font-mono text-foreground">MEMORY_WORKSPACE</code> (or <code className="font-mono text-foreground">PO_WORKSPACE</code>) in{" "}
              <code className="font-mono text-foreground">.env.local</code> at the po-workspace checkout and restart the dev server.
            </>
          }
        />
      ) : q.error || !health ? (
        <ErrorState size="sm" title="Could not check the memory vault" error={q.error ?? undefined} onRetry={() => void q.refetch()} />
      ) : (
        <div className="flex flex-col gap-5">
          {health.state === "building" ? (
            <p role="status" className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />
              Building the memory search index — the checks run again once it is ready.
            </p>
          ) : null}
          <div className="grid gap-6 @2xl:grid-cols-2 @5xl:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] @5xl:gap-10">
            <ScoreZone health={health} />
            <IssuesZone health={health} />
            <div className="@2xl:col-span-2 @5xl:col-span-1">
              <FiguresZone health={health} />
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
