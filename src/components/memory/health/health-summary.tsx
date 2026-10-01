"use client";

/**
 * The "Vault health" card at the top of the Health tab (plan §3): the score ring, the band pill
 * and the pass / warning / fail counts, one striped bar per group (points earned of possible),
 * how the score is made (a popover), when the checks ran and "Run checks again" (`?refresh=1`).
 * A building, partial or capped payload says so in a line under the counts.
 */
import { CircleMinus, CircleQuestionMark, Info, Loader2, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { RelativeTime, SectionCard, StatusPill, StripedBar } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRecheckMemoryHealth } from "@/lib/api/queries";
import { plural } from "@/lib/format";
import { HEALTH_BANDS, HEALTH_CHECKS, HEALTH_GROUPS, HEALTH_THRESHOLDS } from "@/lib/memory/health-rules";
import type { MemoryHealthCheck, MemoryHealthGroupId, MemoryHealthPayload, MemoryHealthStatus } from "@/lib/memory/types";
import type { Tone } from "@/lib/weft/labels";
import { formatPoints, HEALTH_BAND_META, HEALTH_GROUP_META, HEALTH_STATUS_META } from "./check-meta";
import { ScoreRing } from "./score-ring";

const COUNT_WORDS: Record<MemoryHealthStatus, [string, string]> = {
  pass: ["passing", "passing"],
  warn: ["warning", "warnings"],
  fail: ["failing", "failing"],
  skipped: ["not checked", "not checked"],
};

/** A group bar's tone is its worst check's (color means status, STYLE.md 4). */
function groupTone(checks: readonly MemoryHealthCheck[], id: MemoryHealthGroupId): Tone {
  const inGroup = checks.filter((c) => c.group === id);
  if (inGroup.some((c) => c.status === "fail")) return "danger";
  if (inGroup.some((c) => c.status === "warn")) return "attention";
  return "success";
}

/** Why checks were skipped: each distinct note once. */
function skipReasons(checks: readonly MemoryHealthCheck[]): string[] {
  return [...new Set(checks.flatMap((c) => (c.status === "skipped" && c.note ? [c.note] : [])))];
}

function Notice({ icon, children }: { icon: "info" | "busy"; children: ReactNode }) {
  return (
    <p role="status" className="flex items-start gap-2 text-[13px] leading-5 text-muted-foreground">
      {icon === "busy" ? <Loader2 aria-hidden className="mt-0.5 size-3.5 shrink-0 animate-spin" /> : <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />}
      <span>{children}</span>
    </p>
  );
}

function ScoringPopover() {
  const groups = HEALTH_GROUPS.map((g) => `${HEALTH_GROUP_META[g.id].label} ${g.weight}`).join(", ");
  const bands = HEALTH_BANDS.map((b, i) => (i === HEALTH_BANDS.length - 1 ? `${HEALTH_BAND_META[b.band].label} below ${HEALTH_BANDS[i - 1].min}` : `${HEALTH_BAND_META[b.band].label} ${b.min}+`)).join(" · ");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <CircleQuestionMark aria-hidden />
          How is this scored?
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(23rem,calc(100vw-2rem))] gap-2 p-4 text-[13px] leading-5">
        <p className="font-medium text-heading">How the score is made</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-muted-foreground marker:text-muted-numeral">
          <li>
            {HEALTH_CHECKS.length} checks in four groups worth 100 points: {groups}.
          </li>
          <li>A passing check earns its points, a warning half of them, a failure none.</li>
          <li>Recency and the Coverage checks earn the share of notes that qualify. Coverage never counts as a failure.</li>
          <li>Checks that cannot run are left out, and the others scale up to 100.</li>
          <li>
            A fatal lint finding caps the score at {HEALTH_THRESHOLDS.capLoadsFail}, a missing search index at {HEALTH_THRESHOLDS.capIndexMissing}.
          </li>
          <li>{bands}.</li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export interface MemoryHealthSummaryProps {
  health: MemoryHealthPayload;
  className?: string;
}

export function MemoryHealthSummary({ health, className }: MemoryHealthSummaryProps) {
  const recheck = useRecheckMemoryHealth();
  const band = health.band ? HEALTH_BAND_META[health.band] : null;
  const building = health.state === "building";
  const { counts, vault } = health;
  const evaluated = counts.pass + counts.warn + counts.fail;
  const reasons = skipReasons(health.checks);
  const loadsFail = health.checks.some((c) => c.id === "loads" && c.status === "fail");
  // Notes, claims and edges come from the snapshot, which is not read while the index is missing.
  const figures =
    health.index.state === "ready" && !health.errors.some((e) => e.source === "snapshot")
      ? `${plural(vault.notes, "note")} · ${plural(vault.edges, "connection")} · ${plural(vault.claims, "claim")}`
      : `${plural(vault.notes, "note")} on disk`;

  return (
    <SectionCard title="Vault health" description={figures} className={className}>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-10">
        <div className="flex min-w-0 flex-1 flex-col gap-5 sm:flex-row sm:items-center sm:gap-8">
          <ScoreRing score={health.score} band={health.band} />
          <div className="flex min-w-0 flex-col gap-3">
            {band ? (
              <StatusPill tone={band.tone} icon={band.icon} label={band.label} />
            ) : (
              <StatusPill tone="neutral" icon={CircleMinus} label={building ? "Waiting for the index" : "Not scored yet"} />
            )}
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-label="Check results">
              {(["pass", "warn", "fail", "skipped"] as const)
                .filter((status) => status !== "skipped" || counts.skipped > 0)
                .map((status) => {
                  const meta = HEALTH_STATUS_META[status];
                  const n = counts[status];
                  const [one, many] = COUNT_WORDS[status];
                  return (
                    <li key={status}>
                      <StatusPill variant="plain" tone={n > 0 ? meta.tone : "neutral"} icon={meta.icon} label={`${n} ${n === 1 ? one : many}`} />
                    </li>
                  );
                })}
            </ul>
            {building ? <Notice icon="busy">The search index is building; the checks run again when it finishes.</Notice> : null}
            {!building && reasons.length > 0 ? (
              <Notice icon="info">
                {evaluated === 0 ? "No check could run yet" : `${plural(counts.skipped, "check")} could not run`}: {reasons.join("; ")}.
                {evaluated > 0 ? ` The score covers the other ${evaluated}.` : null}
              </Notice>
            ) : null}
            {!building && health.score !== null && (loadsFail || health.index.state === "missing") ? (
              <Notice icon="info">
                {loadsFail
                  ? `The score is capped at ${HEALTH_THRESHOLDS.capLoadsFail} while a fatal lint finding blocks the index build.`
                  : `The score is capped at ${HEALTH_THRESHOLDS.capIndexMissing} until the search index is built.`}
              </Notice>
            ) : null}
          </div>
        </div>
        <ul className="flex w-full flex-col gap-3.5 border-t border-rule pt-5 lg:w-[380px] lg:shrink-0 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10 xl:w-[440px]" aria-label="Points by group">
          {health.groups.map((g) => {
            const meta = HEALTH_GROUP_META[g.id];
            return (
              <li key={g.id} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3 text-[15px] leading-5">
                  <span className="min-w-0 truncate text-muted-foreground">{meta.label}</span>
                  <span className="shrink-0 text-heading tabular-nums">
                    {g.possible === 0 ? (
                      <span className="text-muted-foreground">Not checked</span>
                    ) : (
                      <>
                        {formatPoints(g.earned)}
                        <span className="text-muted-foreground"> / {g.possible}</span>
                      </>
                    )}
                  </span>
                </div>
                <StripedBar
                  value={g.earned}
                  max={Math.max(g.possible, 1)}
                  tone={groupTone(health.checks, g.id)}
                  height={10}
                  label={g.possible === 0 ? `${meta.label}: not checked` : `${meta.label}: ${formatPoints(g.earned)} of ${g.possible} points`}
                />
              </li>
            );
          })}
        </ul>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-rule pt-4">
        <p className="text-[13px] leading-5 text-muted-foreground">
          Checked <RelativeTime at={health.checkedAt} />
          {health.lint && health.lint.checkedAt < health.checkedAt - 60_000 ? (
            <>
              {" "}
              · lint from <RelativeTime at={health.lint.checkedAt} />
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ScoringPopover />
          <Button variant="secondary" size="sm" onClick={() => recheck.mutate()} disabled={recheck.isPending || building}>
            {recheck.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />}
            {recheck.isPending ? "Checking…" : "Run checks again"}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
