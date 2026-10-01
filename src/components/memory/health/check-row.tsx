"use client";

/**
 * One check on the Health tab (plan §3), collapsible. Closed: the check's icon and name, its
 * status pill (icon + label), the one-line measure and the points it earns. Open: why it
 * matters, how to fix it in a well (backticks render as mono code), any note, and the affected
 * notes as links with why each is listed ("and N more" past the 50 the server sends). The index
 * row adds a Rebuild index button. The row's id is the `#check-<id>` anchor.
 */
import { ChevronDown, Info, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { StatusPill } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useRebuildMemoryIndex } from "@/lib/api/queries";
import { formatNumber, plural } from "@/lib/format";
import type { MemoryHealthCheck, MemoryHealthCheckId } from "@/lib/memory/types";
import { cn } from "@/lib/utils";
import { checkAnchor, formatPoints, HEALTH_CHECK_META, HEALTH_STATUS_META, pointsEarned } from "./check-meta";

/** What a check's affected entries are, for the count above the list. */
const AFFECTED_NOUN: Partial<Record<MemoryHealthCheckId, [string, string]>> = {
  loads: ["finding", "findings"],
  lint: ["finding", "findings"],
  links: ["broken link", "broken links"],
  committed: ["uncommitted note", "uncommitted notes"],
  "stale-docs": ["drifted document", "drifted documents"],
};

/** Text with `code` spans: backticked parts render as inline mono code. */
export function InlineCode({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="rounded-[6px] bg-foreground/[0.06] px-1 py-px font-mono text-[12px] text-heading [overflow-wrap:anywhere] dark:bg-foreground/[0.09]">
            {part}
          </code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function RebuildIndexButton() {
  const rebuild = useRebuildMemoryIndex();
  return (
    <Button variant="secondary" size="sm" className="w-fit" onClick={() => rebuild.mutate()} disabled={rebuild.isPending}>
      {rebuild.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />}
      {rebuild.isPending ? "Rebuilding the index…" : "Rebuild index"}
    </Button>
  );
}

function AffectedList({ check }: { check: MemoryHealthCheck }) {
  const [one, many] = AFFECTED_NOUN[check.id] ?? ["note", "notes"];
  const more = check.affectedTotal - check.affected.length;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground">{plural(check.affectedTotal, one, many)}</p>
      <ul className="grid max-h-80 gap-x-6 gap-y-1.5 overflow-y-auto sm:grid-cols-2">
        {check.affected.map((a, i) => (
          <li key={`${a.id ?? a.path ?? "?"}-${i}`} className="flex min-w-0 flex-col">
            {a.id ? (
              <Link
                href={`/memory/${a.id}`}
                className="w-fit max-w-full truncate rounded-[4px] font-medium text-heading underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {a.title ?? a.id}
              </Link>
            ) : (
              <span className="truncate font-mono text-xs leading-5 text-heading" title={a.path ?? undefined}>
                {a.title ?? a.path ?? "Unknown file"}
              </span>
            )}
            {a.detail ? <span className="text-xs leading-4 text-muted-foreground [overflow-wrap:anywhere]">{a.detail}</span> : null}
          </li>
        ))}
      </ul>
      {more > 0 ? <p className="text-muted-foreground">and {formatNumber(more)} more</p> : null}
    </div>
  );
}

export interface CheckRowProps {
  check: MemoryHealthCheck;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CheckRow({ check, open, onOpenChange }: CheckRowProps) {
  const meta = HEALTH_CHECK_META[check.id];
  const status = HEALTH_STATUS_META[check.status];
  const Icon = meta.icon;
  const skipped = check.status === "skipped";

  return (
    <li id={checkAnchor(check.id)} className="scroll-mt-24">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-start gap-3 rounded-[16px] px-3 py-3 text-left outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-well text-heading" aria-hidden>
              <Icon className="size-4" strokeWidth={1.75} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="text-[15px] leading-5 font-medium text-heading">{meta.label}</span>
                <StatusPill size="sm" tone={status.tone} icon={status.icon} label={status.label} />
              </span>
              <span className="text-[13px] leading-5 text-muted-foreground">{skipped && check.note ? check.note : check.measure.summary}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2 pt-1.5">
              <span className="text-[13px] leading-5 text-muted-foreground tabular-nums">
                {skipped ? (
                  <>
                    –<span className="sr-only">, not scored</span>
                  </>
                ) : (
                  <>
                    <span className="text-heading">{formatPoints(pointsEarned(check))}</span>/{check.weight}
                    <span className="sr-only"> points</span>
                  </>
                )}
              </span>
              <ChevronDown aria-hidden className={cn("size-4 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none", !open && "-rotate-90")} />
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-3 pr-3 pb-4 pl-3 text-[13px] leading-5 sm:pl-14">
            <p className="text-muted-foreground">
              <InlineCode text={meta.why} />
            </p>
            <div className="rounded-[14px] bg-well/70 px-3.5 py-2.5 text-heading dark:bg-well">
              <span className="font-medium">How to fix: </span>
              <InlineCode text={meta.fix} />
            </div>
            {check.note && !skipped ? (
              <p className="flex items-start gap-2 text-muted-foreground">
                <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
                <span>{check.note}</span>
              </p>
            ) : null}
            {check.id === "index" && !skipped ? <RebuildIndexButton /> : null}
            {check.affected.length > 0 ? <AffectedList check={check} /> : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
