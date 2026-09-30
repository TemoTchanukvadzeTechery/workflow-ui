"use client";

/** Project KPI row: requirements, epics, tasks approved, acceptance criteria met, evidence, spend. */
import { KpiTile, Money } from "@/components/common";
import type { ProjectBundle } from "@/lib/delivery/types";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";

const IN_FLIGHT = new Set(["in_progress", "verifying", "in_review", "changes_requested"]);

export function ProjectKpis({ bundle, className }: { bundle: ProjectBundle; className?: string }) {
  const base = `/projects/${encodeURIComponent(bundle.project.id)}`;
  const brd = [...bundle.documents].reverse().find((d) => d.kind === "brd" && d.status !== "superseded");
  const aad = [...bundle.documents].reverse().find((d) => d.kind === "aad" && d.status !== "superseded");
  const brs = brd?.requirements ?? [];
  const candidates = brs.filter((r) => r.candidate).length;
  const frs = aad?.frs?.length ?? 0;

  const epics = bundle.epics;
  const synced = epics.filter((e) => e.status === "synced").length;
  const accepted = epics.filter((e) => e.status !== "draft").length;

  const tasks = bundle.tasks.filter((t) => t.status !== "cancelled");
  const approved = tasks.filter((t) => t.status === "done").length;
  const inFlight = tasks.filter((t) => IN_FLIGHT.has(t.status)).length;

  const acs = tasks.flatMap((t) => t.acceptanceCriteria);
  const met = acs.filter((a) => a.met).length;

  const evidence = bundle.evidence.filter((e) => !e.supersededBy);
  const pass = evidence.filter((e) => e.result === "pass").length;
  const fail = evidence.filter((e) => e.result === "fail").length;

  const runs = Object.values(bundle.stages).reduce((n, s) => n + s.runs.length, 0);

  return (
    <div className={cn("grid grid-cols-2 gap-4 @3xl:grid-cols-3 @7xl:grid-cols-6", className)}>
      <KpiTile
        label="Requirements"
        value={brs.length}
        href={brd ? `${base}/docs/${encodeURIComponent(brd.id)}` : `${base}/requirements`}
        hint={brd ? `BR in the BRD${candidates ? ` · ${candidates} candidate` : ""}${frs ? ` · ${frs} FRs` : ""}` : "No BRD yet"}
      />
      <KpiTile
        label="Epics"
        value={epics.length}
        href={`${base}/requirements?step=epics`}
        hint={epics.length ? `${synced} in Jira · ${accepted} accepted` : "Proposed from the BRD"}
      />
      <KpiTile
        label="Tasks approved"
        value={
          <span>
            {approved}
            <span className="text-muted-numeral">/{tasks.length}</span>
          </span>
        }
        href={`${base}/implementation`}
        hint={tasks.length ? `${inFlight} in flight` : "Tasks come with the plan"}
      />
      <KpiTile
        label="ACs met"
        value={
          <span>
            {met}
            <span className="text-muted-numeral">/{acs.length}</span>
          </span>
        }
        href={`${base}/qa?step=traceability`}
        hint={acs.length ? "Acceptance criteria with evidence" : "No acceptance criteria yet"}
      />
      <KpiTile label="Evidence" value={evidence.length} href={`${base}/qa`} hint={evidence.length ? `${pass} pass · ${fail} fail` : "Attached by qa-verify"} />
      <KpiTile label="Spend" value={<Money usd={bundle.spendUsd} />} href="/runs" hint={plural(runs, "agent run")} className="col-span-2 @3xl:col-span-1" />
    </div>
  );
}
