"use client";

/**
 * Chips and badges the epic views share: the Jira key cell ("Not in Jira yet" until "Create in Jira"),
 * requirement ref chips with the requirement text on hover, the "Changed in Architecture" badge,
 * blocked-by chips and the mock Jira banner.
 */
import { Ban, GitBranch, Info, Network } from "lucide-react";
import type { ReactNode } from "react";
import { IdChip, StatusPill } from "@/components/common";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Epic } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";

export function EpicKey({ epic, className }: { epic: Epic; className?: string }) {
  if (epic.key) return <IdChip id={epic.key} size="sm" className={className} />;
  // The status pill beside it says Draft / Accepted; the key cell only says whether Jira has it.
  return <span className={cn("text-xs whitespace-nowrap text-muted-foreground", className)}>Not in Jira yet</span>;
}

/** Ref chips (BR-1, FR3); `texts` supplies the hover text per id. */
export function RefChips({ refs, texts, tone = "neutral", empty = "—", className, max }: { refs: string[]; texts?: Record<string, string>; tone?: "neutral" | "primary"; empty?: ReactNode; className?: string; max?: number }) {
  if (refs.length === 0) return <span className="text-xs text-muted-foreground">{empty}</span>;
  const shown = max ? refs.slice(0, max) : refs;
  const rest = refs.length - shown.length;
  return (
    <TooltipProvider delayDuration={150}>
      <span className={cn("inline-flex flex-wrap gap-1", className)}>
        {shown.map((r) => {
          const chip = (
            <span
              className={cn(
                "inline-flex h-5 items-center rounded-md px-1.5 font-mono text-[11px] whitespace-nowrap",
                tone === "primary" ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              {r}
            </span>
          );
          const text = texts?.[r];
          if (!text) return <span key={r}>{chip}</span>;
          return (
            <Tooltip key={r}>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label={`${r}: ${text}`}>
                  {chip}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <span className="font-mono">{r}</span> {text}
              </TooltipContent>
            </Tooltip>
          );
        })}
        {rest > 0 ? <span className="inline-flex h-5 items-center px-1 text-[11px] text-muted-foreground">+{rest}</span> : null}
      </span>
    </TooltipProvider>
  );
}

export function ChangedInArchitecture({ className }: { className?: string }) {
  return <StatusPill tone="review" icon={Network} label="Changed in Architecture" size="sm" className={className} />;
}

export function BlockedBy({ ids, className }: { ids?: string[]; className?: string }) {
  if (!ids?.length) return null;
  return <StatusPill tone="attention" icon={Ban} label={`Blocked by ${ids.join(", ")}`} size="sm" className={className} title="Stays draft until the open question is answered" />;
}

export function ParentChip({ parent, className }: { parent?: string; className?: string }) {
  if (!parent) return null;
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-md border border-border px-1.5 font-mono text-[11px] text-muted-foreground", className)} title={`Parent epic ${parent}`}>
      <GitBranch aria-hidden className="size-3" />
      under {parent}
    </span>
  );
}

export function MockJiraBanner({ className }: { className?: string }) {
  return (
    <div role="note" className={cn("flex items-start gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-[13px] text-muted-foreground", className)}>
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-medium text-foreground">Mock: po-brd and architect-aad do not write to Jira today.</span> Epics are proposed here from the document; &ldquo;Create in Jira&rdquo; assigns mock keys.
      </p>
    </div>
  );
}

/** id → text maps for tooltips. */
export function refTexts(list: Array<{ id: string; text: string }> | undefined): Record<string, string> {
  return Object.fromEntries((list ?? []).map((r) => [r.id, r.text]));
}
