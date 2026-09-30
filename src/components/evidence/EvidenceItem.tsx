"use client";

/**
 * The frame every evidence item shares: title, result pill, kind and level, the ACs it proves
 * (each chip toned by that AC's own result), environment, build, observedAt, "Recorded by", and
 * the "Superseded by" note. Evidence is immutable: a newer run's item supersedes, never edits.
 */
import { Bot, Camera, Database, FileText, Film, Gauge, History, ScrollText, SquareTerminal, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { actorText, IdChip, StatusPill } from "@/components/common";
import type { Evidence } from "@/lib/delivery/types";
import { formatBytes, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { evidenceResultMeta } from "@/lib/weft/labels";
import { evidenceDomId, KIND_LABEL, TEST_LEVEL_LABEL } from "./utils";

const KIND_ICON: Record<Evidence["kind"], LucideIcon> = {
  video: Film,
  screenshot: Camera,
  "contact-sheet": Camera,
  log: ScrollText,
  "test-report": FileText,
  "command-output": SquareTerminal,
  data: Database,
  metric: Gauge,
};

export function EvidenceResultPill({ result, size = "sm" }: { result: Evidence["result"]; size?: "sm" | "md" }) {
  return <StatusPill {...evidenceResultMeta(result)} size={size} />;
}

/** AC chips: "AC-1" with a result icon; clicking one filters the gallery to that AC. */
export function AcChips({ item, onSelect, active }: { item: Evidence; onSelect?: (acId: string) => void; active?: string | null }) {
  if (item.criterionResults.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-1" aria-label="Acceptance criteria this item covers">
      {item.criterionResults.map((c) => {
        const meta = evidenceResultMeta(c.result);
        const Icon = meta.icon;
        const tone = c.result === "pass" ? "text-status-success-fg" : c.result === "fail" ? "text-status-danger-fg" : "text-status-attention-fg";
        const body = (
          <>
            <Icon aria-hidden className={cn("size-3", tone)} strokeWidth={2.25} />
            <span className="font-mono">{c.criterionId}</span>
            <span className="sr-only">: {meta.label}</span>
          </>
        );
        const cls = cn(
          "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs leading-none text-heading",
          active === c.criterionId ? "border-primary bg-primary-soft" : "border-circle-border bg-transparent",
        );
        return (
          <li key={c.criterionId} title={c.detail ? `${c.criterionId} ${meta.label.toLowerCase()}: ${c.detail}` : `${c.criterionId} ${meta.label.toLowerCase()}`}>
            {onSelect ? (
              <button type="button" onClick={() => onSelect(c.criterionId)} className={cn(cls, "hover:border-primary/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none")} aria-pressed={active === c.criterionId}>
                {body}
              </button>
            ) : (
              <span className={cls}>{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * "internal-apps-test · feature-…@8d41e07 · Sep 29, 14:02 · Recorded by weft · qa-verify". Mono
 * values truncate; with `wrap` (the lightbox) they break anywhere instead, so the whole build
 * ref stays readable on a phone.
 */
export function EvidenceFacts({ item, className, wrap }: { item: Evidence; className?: string; wrap?: boolean }) {
  const mono = wrap ? "break-all" : "truncate";
  return (
    <dl className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground", className)}>
      <div className="flex min-w-0 max-w-full items-center gap-1">
        <dt className="sr-only">Environment</dt>
        <dd className={cn("min-w-0 font-mono text-xs", mono)}>{item.environment}</dd>
      </div>
      <div className={cn("flex min-w-0 max-w-full gap-1", wrap ? "items-baseline" : "items-center")}>
        <dt className="shrink-0">build</dt>
        <dd className={cn("min-w-0 font-mono text-xs text-foreground", mono)} title={item.build}>
          {item.build}
        </dd>
      </div>
      <div className="flex items-center gap-1">
        <dt className="sr-only">Observed</dt>
        <dd>
          <time dateTime={new Date(item.observedAt).toISOString()} suppressHydrationWarning>
            {formatDateTime(item.observedAt, { seconds: false })}
          </time>
        </dd>
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <dt className="sr-only">Recorded by</dt>
        <dd className="inline-flex min-w-0 items-center gap-1">
          <Bot aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">
            Recorded by {actorText(item.producedBy)}
            {item.producedBy.kind === "agent" && item.producedBy.model ? ` (${item.producedBy.model})` : ""}
          </span>
        </dd>
      </div>
    </dl>
  );
}

export interface EvidenceItemProps {
  item: Evidence;
  children?: ReactNode;
  /** Right side of the header, e.g. an "Open" button. */
  actions?: ReactNode;
  onSelectAc?: (acId: string) => void;
  activeAc?: string | null;
  /** Superseded item: the id of the newer one, rendered as a link-like button. */
  onJumpTo?: (evidenceId: string) => void;
  highlighted?: boolean;
  className?: string;
}

export function EvidenceItem({ item, children, actions, onSelectAc, activeAc, onJumpTo, highlighted, className }: EvidenceItemProps) {
  const Icon = KIND_ICON[item.kind];
  const level = item.testLevel && item.testLevel !== "manual" ? item.testLevel : null;
  return (
    <article
      id={evidenceDomId(item.id)}
      aria-label={`${item.id}: ${item.title}`}
      className={cn(
        "min-w-0 scroll-mt-24 rounded-[20px] bg-field shadow-[0_0_0_1px_var(--rule),0_1px_2px_rgb(0_0_0/0.04)] transition-shadow duration-150",
        highlighted && "shadow-[0_0_0_2px_var(--ring),0_10px_24px_-14px_rgb(27_111_252/0.5)]",
        item.supersededBy && "opacity-75",
        className,
      )}
    >
      <header className="flex flex-col gap-2.5 px-4 pt-4 pb-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-well text-heading">
            <Icon aria-hidden className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h4 className="text-[15px] leading-[22px] font-medium break-words text-heading">{item.title}</h4>
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              <span className="font-mono">{item.id}</span>
              <span aria-hidden>·</span>
              <span>{KIND_LABEL[item.kind]}</span>
              <span aria-hidden>·</span>
              <span>{item.mode === "automated" ? "Automated" : "Manual"}</span>
              {level ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{TEST_LEVEL_LABEL[level]}</span>
                </>
              ) : null}
              {item.sizeBytes ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">{formatBytes(item.sizeBytes)}</span>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <EvidenceResultPill result={item.result} />
            {actions}
          </div>
        </div>
        <AcChips item={item} onSelect={onSelectAc} active={activeAc} />
        {item.supersededBy ? (
          <p className="inline-flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <History aria-hidden className="size-3.5" />
            Superseded by
            {onJumpTo ? (
              <button type="button" onClick={() => onJumpTo(item.supersededBy!)} className="font-mono text-xs text-primary underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                {item.supersededBy}
              </button>
            ) : (
              <IdChip id={item.supersededBy} size="sm" copy={false} />
            )}
            <span>from a newer QA run; kept for the record.</span>
          </p>
        ) : null}
      </header>
      {children ? <div className="min-w-0 px-4 pb-4">{children}</div> : null}
      <footer className="border-t border-rule px-4 py-2.5">
        <EvidenceFacts item={item} />
      </footer>
    </article>
  );
}
