"use client";

/**
 * Every human decision on the project, oldest first: accepted documents, stage gate approvals
 * and change requests (with the comment and the warnings the approver acknowledged), imports,
 * reopened stages and the final sign-off. The latest few show; earlier ones open on demand, so
 * the card never clips an entry mid-line.
 */
import { ChevronUp, CircleCheck, FileCheck2, Gavel, Import, RotateCcw, TriangleAlert, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { actorText, EmptyState, RelativeTime, SectionCard, toneClasses } from "@/components/common";
import { Button } from "@/components/ui/button";
import { STAGES, stageDef, type Actor, type ProjectBundle, type StageId } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/weft/labels";

interface Entry {
  id: string;
  at: number;
  stage: StageId;
  title: string;
  by?: Actor;
  comment?: string;
  warnings?: string[];
  icon: LucideIcon;
  tone: Tone;
}

/** Entries shown before "Show earlier". */
const LATEST = 6;

const DOC_LABEL = { brd: "BRD", aad: "AAD", memory: "Memory update", plan: "Implementation plan", "ready-for-test": "Ready-for-test note" } as const;
const DOC_STAGE: Record<keyof typeof DOC_LABEL, StageId> = { brd: "requirements", aad: "architecture", memory: "requirements", plan: "implementation", "ready-for-test": "implementation" };

function collect(bundle: ProjectBundle): Entry[] {
  const out: Entry[] = [];
  const { project } = bundle;
  for (const def of STAGES) {
    const st = project.stages[def.id];
    for (const d of st.decisions) {
      const approved = d.decision === "approved";
      out.push({
        id: d.id,
        at: d.at,
        stage: def.id,
        title: approved ? (def.id === "signoff" ? "Signed off: project done" : `${def.title} approved`) : `Changes requested on ${def.title}`,
        by: d.by,
        comment: d.comment,
        warnings: d.acknowledgedWarnings,
        icon: approved ? CircleCheck : RotateCcw,
        tone: approved ? "success" : "danger",
      });
    }
    for (const [i, r] of (st.reopened ?? []).entries()) {
      out.push({ id: `reopen-${def.id}-${i}`, at: r.at, stage: def.id, title: `${def.title} reopened from ${stageDef(r.fromStage).title}`, by: r.by, comment: r.comment, icon: RotateCcw, tone: "attention" });
    }
    if (st.imported) {
      const doc = def.id === "architecture" ? "AAD" : "BRD";
      const from = st.imported.source === "confluence" ? `from Confluence${st.imported.ref ? ` page ${st.imported.ref}` : ""}` : "from pasted markdown";
      out.push({ id: `import-${def.id}`, at: st.imported.at, stage: def.id, title: `${doc} imported ${from}`, by: st.imported.by, icon: Import, tone: "neutral" });
    }
  }
  for (const doc of bundle.documents) {
    if (doc.status === "draft" || !doc.acceptedAt || !doc.acceptedBy || doc.acceptedBy.kind !== "human") continue;
    if (doc.versions.at(-1)?.source === "import") continue; // the import entry covers it
    const v = doc.versions.at(-1)?.n;
    out.push({
      id: `doc-${doc.id}`,
      at: doc.acceptedAt,
      stage: DOC_STAGE[doc.kind],
      title: `${DOC_LABEL[doc.kind]}${v ? ` v${v}` : ""} accepted`,
      by: doc.acceptedBy,
      icon: FileCheck2,
      tone: "success",
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

export function DecisionsLog({ bundle, className }: { bundle: ProjectBundle; className?: string }) {
  const all = collect(bundle);
  const [showAll, setShowAll] = useState(false);
  const earlier = showAll ? 0 : Math.max(0, all.length - LATEST);
  const entries = all.slice(earlier);
  return (
    <SectionCard title="Decisions" description="Who accepted what, and the warnings they ticked through" className={className}>
      {all.length === 0 ? (
        <EmptyState size="sm" icon={Gavel} title="No decisions yet" body="Accepted documents, stage approvals and change requests show up here with who made them." />
      ) : (
        <>
          {earlier > 0 ? (
            <Button variant="ghost" size="sm" className="mb-2 -ml-2 rounded-full text-muted-foreground" onClick={() => setShowAll(true)}>
              <ChevronUp aria-hidden />
              Show {earlier} earlier {earlier === 1 ? "decision" : "decisions"}
            </Button>
          ) : null}
          <ol className="flex flex-col">
            {entries.map((e, i) => {
              const t = toneClasses(e.tone);
              const Icon = e.icon;
              return (
                <li key={e.id} className="flex gap-3">
                  <span className="flex flex-col items-center self-stretch">
                    <span aria-hidden className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full", t.bg, t.text)}>
                      <Icon className="size-3.5" strokeWidth={2} />
                    </span>
                    {i < entries.length - 1 ? <span aria-hidden className="mt-1 w-px flex-1 bg-border" /> : null}
                  </span>
                  <div className="min-w-0 flex-1 pb-4">
                    <p className="text-[13px] leading-5 font-medium text-foreground">{e.title}</p>
                    <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                      <span>Stage {stageDef(e.stage).n}</span>
                      {e.by ? (
                        <>
                          <span aria-hidden>·</span>
                          <span className={cn(e.by.kind !== "human" && "font-mono")}>{actorText(e.by)}</span>
                        </>
                      ) : null}
                      <span aria-hidden>·</span>
                      <RelativeTime at={e.at} />
                    </p>
                    {e.comment ? <blockquote className="mt-1.5 border-l-2 pl-2.5 text-[13px] leading-5 text-foreground/85">{e.comment}</blockquote> : null}
                    {e.warnings?.length ? (
                      <div className="mt-2 rounded-xl bg-status-attention-bg/60 px-3 py-2">
                        <p className="text-[11px] font-medium text-status-attention-fg">Acknowledged {e.warnings.length === 1 ? "warning" : `${e.warnings.length} warnings`}</p>
                        <ul className="mt-1 space-y-0.5">
                          {e.warnings.map((w) => (
                            <li key={w} className="flex gap-1.5 text-xs leading-5 text-foreground/85">
                              <TriangleAlert aria-hidden className="mt-1 size-3 shrink-0 text-status-attention-fg" />
                              <span className="min-w-0">{w}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </SectionCard>
  );
}
