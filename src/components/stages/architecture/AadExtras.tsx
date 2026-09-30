"use client";

/**
 * AAD extras shown with the draft: the FR trace (each functional requirement with its
 * "[B1 §Requirements n]" chips, which jump to that BRD requirement, and its design element), the
 * BRD requirements no FR traces yet, and the Document Acceptance table as a read-only department
 * checklist (NOT APPROVED / CONDITIONAL / APPROVED).
 */
import { ChevronDown, CircleCheck, CircleDashed, CircleMinus, CircleX, Route } from "lucide-react";
import { useState } from "react";
import { SectionCard, StatusPill } from "@/components/common";
import { Button } from "@/components/ui/button";
import type { AadRequirement, BrdRequirement } from "@/lib/delivery/types";
import type { Tone } from "@/lib/weft/labels";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------------------------
// FR trace
// ---------------------------------------------------------------------------------------------

export interface FrTraceProps {
  frs: AadRequirement[];
  requirements: BrdRequirement[];
  /** From the AAD draft report: "BRD requirements not traced". */
  untraced?: string[];
  onTraceClick?: (brId: string) => void;
  className?: string;
}

const brNumber = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);

/** "BR-7" from a draft-report line such as "BRD requirement 7 (candidate) — carried as FR7 …". */
function untracedId(line: string): string | undefined {
  const m = /^\s*(?:BRD requirement|BR-?|B1 §Requirements)\s*(\d+)/i.exec(line);
  return m?.[1] ? `BR-${m[1]}` : undefined;
}

function TraceChip({ brId, text, onClick }: { brId: string; text?: string; onClick?: (id: string) => void }) {
  const label = `B1 §Requirements ${brNumber(brId)}`;
  if (!onClick) return <span className="token-chip h-6 font-mono text-[11.5px]">[{label}]</span>;
  return (
    <button
      type="button"
      onClick={() => onClick(brId)}
      title={text ? `${brId}: ${text}` : `Show ${brId} in the BRD`}
      aria-label={`Show ${brId} in the BRD${text ? `: ${text}` : ""}`}
      className="token-chip h-6 font-mono text-[11.5px] transition-[filter] hover:brightness-95 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none dark:hover:brightness-125"
    >
      [{label}]
    </button>
  );
}

/**
 * One statement for the card header, so the table count and the draft report never contradict
 * each other: "8 FRs cite 8 of 8 BRD requirements; the draft report still flags BR-7 and BR-8 as
 * not traced."
 */
function traceSummary(frCount: number, tracedCount: number, brCount: number, untraced: string[]): string {
  const cite = `${frCount} ${frCount === 1 ? "FR cites" : "FRs cite"} ${tracedCount === brCount && brCount > 0 ? `all ${brCount}` : `${tracedCount} of ${brCount}`} BRD ${brCount === 1 ? "requirement" : "requirements"}`;
  if (untraced.length === 0) return `${cite}. Select a chip to open that requirement in the BRD.`;
  const ids = untraced.map(untracedId);
  const named = ids.every(Boolean) ? (ids as string[]) : undefined;
  const flagged = named ? (named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`) : `${untraced.length} ${untraced.length === 1 ? "requirement" : "requirements"}`;
  return `${cite}; the draft report still flags ${flagged} as not traced (listed below). Select a chip to open that requirement in the BRD.`;
}

export function FrTrace({ frs, requirements, untraced = [], onTraceClick, className }: FrTraceProps) {
  const texts = Object.fromEntries(requirements.map((r) => [r.id, r.text]));
  const traced = new Set(frs.flatMap((f) => f.traces));
  const missing = requirements.filter((r) => !traced.has(r.id));
  if (frs.length === 0) {
    return (
      <SectionCard density="dense" title="FR trace" className={className}>
        <p className="text-[13px] text-muted-foreground">The AAD has no Functional Requirements table yet, so nothing traces to the BRD.</p>
      </SectionCard>
    );
  }
  return (
    <SectionCard
      density="dense"
      title="FR trace"
      className={className}
      description={traceSummary(frs.length, traced.size, requirements.length, untraced)}
    >
      <div className="@container space-y-3">
        {missing.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-[16px] bg-status-attention-bg px-4 py-2.5 text-[13px] text-status-attention-fg">
            <Route aria-hidden className="size-4 shrink-0" />
            <span className="font-medium">No FR traces</span>
            {missing.map((r) => (
              <span key={r.id} className="inline-flex h-6 items-center rounded-[6px] bg-raised/80 px-1.5 font-mono text-[11.5px]" title={r.text}>
                {r.id}
                {r.candidate ? " (candidate)" : ""}
              </span>
            ))}
          </div>
        ) : null}
        {untraced.length > 0 ? (
          <div className="rounded-[16px] bg-well/60 px-4 py-3 text-[13px]">
            <p className="flex items-center gap-1.5 font-medium text-heading">
              <Route aria-hidden className="size-4 shrink-0 text-status-attention-fg" />
              Flagged as not traced in the draft report
            </p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted-foreground">
              {untraced.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <ul className="divide-y divide-rule border-y border-rule" aria-label="Functional requirements">
          {frs.map((f) => (
            <li key={f.id} className="grid gap-1.5 px-1 py-3.5 @2xl:grid-cols-[3.5rem_minmax(0,1.4fr)_minmax(0,1fr)] @2xl:gap-4">
              <span className="font-mono text-xs font-medium text-heading @2xl:pt-0.5">{f.id}</span>
              <div className="min-w-0 space-y-1.5">
                <p className="text-sm leading-5 text-heading">{f.text}</p>
                <div className="flex flex-wrap gap-1">
                  {f.traces.length ? f.traces.map((t) => <TraceChip key={t} brId={t} text={texts[t]} onClick={onTraceClick} />) : <span className="text-xs text-status-attention-fg">No BRD trace</span>}
                </div>
              </div>
              <p className="min-w-0 text-[13px] leading-5 break-words text-muted-foreground">
                <span className="sr-only">Design element: </span>
                {f.designElement || "No design element yet"}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------------------------
// Document Acceptance checklist
// ---------------------------------------------------------------------------------------------

export interface AcceptanceRow {
  department: string;
  representative: string;
  status: string;
  notes: string;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/** Rows of the table under "## Document Acceptance" (Department | Representative | Approval Status | Notes). */
export function parseAcceptance(markdown: string): AcceptanceRow[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{2,4}\s+Document Acceptance\b/i.test(l.trim()));
  if (start < 0) return [];
  const rows: AcceptanceRow[] = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    const t = line.trim();
    if (/^#{1,4}\s/.test(t)) break;
    if (!t.startsWith("|")) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    const c = cells(t);
    if (c.every((x) => /^:?-{2,}:?$/.test(x) || x === "")) continue;
    if (/department/i.test(c[0] ?? "")) continue;
    rows.push({ department: c[0] ?? "", representative: c[1] ?? "", status: c[2] ?? "", notes: c[3] ?? "" });
  }
  return rows.filter((r) => r.department);
}

function statusOf(raw: string): { tone: Tone; label: string; icon: typeof CircleCheck } {
  const s = raw.trim().toUpperCase();
  if (/NOT\s+APPROVED/.test(s)) return { tone: "danger", label: "Not approved", icon: CircleX };
  if (/CONDITIONAL/.test(s)) return { tone: "attention", label: "Conditional", icon: CircleMinus };
  if (/APPROVED/.test(s)) return { tone: "success", label: "Approved", icon: CircleCheck };
  return { tone: "neutral", label: "Not recorded", icon: CircleDashed };
}

export function AcceptanceChecklist({ markdown, className }: { markdown: string; className?: string }) {
  const rows = parseAcceptance(markdown);
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  const tally = (tone: Tone) => rows.filter((r) => statusOf(r.status).tone === tone).length;
  const approved = tally("success");
  const counts = [
    { tone: "success" as Tone, n: approved, label: "approved" },
    { tone: "attention" as Tone, n: tally("attention"), label: "conditional" },
    { tone: "danger" as Tone, n: tally("danger"), label: "not approved" },
    { tone: "neutral" as Tone, n: tally("neutral"), label: "not recorded" },
  ].filter((c) => c.n > 0);
  return (
    <SectionCard
      density="dense"
      title="Document acceptance"
      className={className}
      description={`${approved} of ${rows.length} departments approved. Read-only here: departments record their status in the AAD itself (NOT APPROVED / CONDITIONAL / APPROVED).`}
    >
      {/* The toggle sits in the body, not the header, so the title is never squeezed on a phone. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {counts.map((c) => (
          <StatusPill key={c.label} tone={c.tone} icon={null} label={`${c.n} ${c.label}`} size="sm" />
        ))}
        <Button variant="secondary" size="sm" className="ml-auto" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <ChevronDown aria-hidden className={cn("transition-transform duration-150", !open && "-rotate-90")} />
          {open ? "Hide departments" : "Show departments"}
        </Button>
      </div>
      {open ? (
      <ul className="@container mt-4 divide-y divide-rule border-y border-rule" aria-label="Departments">
        {rows.map((r) => {
          const st = statusOf(r.status);
          return (
            <li key={r.department} className="grid gap-1.5 px-1 py-3 @xl:grid-cols-[minmax(0,14rem)_8.5rem_minmax(0,1fr)] @xl:items-center @xl:gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-heading">{r.department}</p>
                {r.representative ? <p className="text-xs text-muted-foreground">{r.representative}</p> : null}
              </div>
              <StatusPill tone={st.tone} icon={st.icon} label={st.label} size="sm" className="w-fit" />
              <p className={cn("min-w-0 text-[13px] leading-5 break-words text-muted-foreground", !r.notes && "hidden @xl:block")}>{r.notes || "—"}</p>
            </li>
          );
        })}
      </ul>
      ) : null}
    </SectionCard>
  );
}
