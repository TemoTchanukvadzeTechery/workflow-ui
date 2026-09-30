"use client";

/**
 * What the planner reads (brief C.3 Plan): the accepted BRD and AAD versions, the accepted epics,
 * and a read-only system -> repo map built from the AAD's system-change table and the epics'
 * systems. Documents carry the optional parse extras `systems` and `openQuestions` (server C).
 */
import { ArrowUpRight, FileText, Layers, Network } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SectionCard, StatusPill, actorText } from "@/components/common";
import type { DeliveryTask, DocumentArtifact, Epic, ProjectBundle } from "@/lib/delivery/types";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RepoChip } from "@/components/tasks";

export interface SystemChange {
  system: string;
  status: string;
  change: string;
  changed: boolean;
}
export type DocWithExtras = DocumentArtifact & { systems?: SystemChange[]; openQuestions?: Array<{ id: string; text: string; owner?: string }> };

export function docOf(bundle: ProjectBundle, kind: "brd" | "aad" | "plan" | "ready-for-test"): DocWithExtras | undefined {
  const s = bundle.project.stages;
  const id = kind === "brd" ? s.requirements.brdDocId : kind === "aad" ? s.architecture.aadDocId : kind === "plan" ? s.implementation.planDocId : undefined;
  return (id ? bundle.documents.find((d) => d.id === id) : undefined) ?? bundle.documents.find((d) => d.kind === kind && d.status !== "superseded");
}

export function docHref(projectId: string, doc: Pick<DocumentArtifact, "id">, v?: number): string {
  return `/projects/${encodeURIComponent(projectId)}/docs/${encodeURIComponent(doc.id)}${v ? `?v=${v}` : ""}`;
}

/** A plain code repository name ("customer-service-v2"), not a product or platform ("LaunchDarkly"). */
export function isRepoName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(name);
}

/** A nested 20px panel on the card: the well surface (STYLE.md 1). */
const TILE = "flex min-w-0 flex-col gap-2 rounded-[20px] bg-well p-4";

function DocTile({ projectId, label, icon: Icon, doc, facts, imported }: { projectId: string; label: string; icon: typeof FileText; doc?: DocWithExtras; facts: string[]; imported?: boolean }) {
  const version = doc?.versions.at(-1)?.n;
  return (
    <div className={TILE}>
      <div className="flex items-center gap-2">
        <Icon aria-hidden className="size-4 text-muted-foreground" />
        <span className="text-[15px] font-medium text-heading">
          {label}
          {version ? <span className="text-[13px] font-normal text-muted-foreground"> v{version}</span> : null}
        </span>
        <span className="flex-1" />
        {doc ? <StatusPill status={{ kind: "doc", value: doc.status }} size="sm" /> : <StatusPill tone="neutral" label="Missing" size="sm" icon={null} />}
      </div>
      {doc ? (
        <>
          <p className="text-[13px] text-muted-foreground">
            {doc.status === "accepted" && doc.acceptedBy ? `Accepted by ${actorText(doc.acceptedBy)}` : doc.status === "accepted" ? "Accepted" : "Not accepted yet"}
            {imported ? " · imported" : ""}
          </p>
          {facts.length > 0 ? (
            <ul className="space-y-0.5 text-[13px] leading-5 text-foreground">
              {facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
          <Link href={docHref(projectId, doc)} className="mt-auto inline-flex items-center gap-1 pt-1 text-[13px] font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            Open {label}
            <ArrowUpRight aria-hidden className="size-3.5" />
          </Link>
        </>
      ) : (
        <p className="text-[13px] text-muted-foreground">Accept it in its stage first.</p>
      )}
    </div>
  );
}

export function PlanInputs({ projectId, bundle, compact }: { projectId: string; bundle: ProjectBundle; compact?: boolean }) {
  const brd = docOf(bundle, "brd");
  const aad = docOf(bundle, "aad");
  const epics = bundle.epics;
  const parked = epics.filter((e) => e.status === "draft" && (e.blockedBy?.length ?? 0) > 0);
  const usable = epics.filter((e) => !parked.includes(e));
  const synced = usable.filter((e) => e.status === "synced").length;
  const brdOpen = brd?.openQuestions?.length ?? 0;
  const aadOpen = aad?.openQuestions?.length ?? 0;
  const changed = aad?.systems?.filter((s) => s.changed).length;

  return (
    <SectionCard
      density="dense"
      title="What the planner reads"
      description={compact ? undefined : "dev-plan reads the accepted documents, your developer notes and the accepted epics, then proposes tasks in waves. Nothing starts until you approve the plan."}
    >
      <div className="@container">
        <div className="grid gap-3 @xl:grid-cols-3">
          <DocTile
            projectId={projectId}
            label="BRD"
            icon={FileText}
            doc={brd}
            imported={!!bundle.project.stages.requirements.imported}
            facts={[brd?.requirements ? plural(brd.requirements.length, "requirement") : "", brdOpen ? plural(brdOpen, "open question") : ""].filter(Boolean)}
          />
          <DocTile
            projectId={projectId}
            label="AAD"
            icon={Network}
            doc={aad}
            imported={!!bundle.project.stages.architecture.imported}
            facts={[aad?.frs?.length ? plural(aad.frs.length, "functional requirement") : "", changed !== undefined ? `${plural(changed, "system")} changed` : "", aadOpen ? plural(aadOpen, "open question") : ""].filter(Boolean)}
          />
          <div className={TILE}>
            <div className="flex items-center gap-2">
              <Layers aria-hidden className="size-4 text-muted-foreground" />
              <span className="text-[15px] font-medium text-heading">Epics</span>
              <span className="text-[13px] text-muted-foreground tabular-nums">{usable.length}</span>
              <span className="flex-1" />
              {usable.length > 0 && usable.every((e) => e.status !== "draft") ? <StatusPill status={{ kind: "epic", value: synced === usable.length ? "synced" : "accepted" }} size="sm" /> : null}
            </div>
            <p className="text-[13px] text-muted-foreground">
              {synced ? `${synced} created in Jira (mock)` : "Not created in Jira yet"}
              {parked.length ? ` · ${parked.length} parked` : ""}
            </p>
            <ul className="flex flex-col gap-1">
              {usable.slice(0, 5).map((e) => (
                <li key={e.id} className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{e.key ?? e.id}</span>
                  <span className="truncate">{e.title}</span>
                </li>
              ))}
              {usable.length > 5 ? <li className="text-[13px] text-muted-foreground">+{usable.length - 5} more</li> : null}
            </ul>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

interface MapRow {
  system: string;
  status: string;
  change: string;
  changed: boolean;
  epics: Epic[];
  tasks: DeliveryTask[];
  source: "aad" | "epics" | "plan";
}

export function systemRows(bundle: ProjectBundle, extraTasks: ReadonlyArray<{ repo: string }> = []): MapRow[] {
  const aad = docOf(bundle, "aad");
  const rows = new Map<string, MapRow>();
  for (const s of aad?.systems ?? []) rows.set(s.system, { system: s.system, status: s.status, change: s.change, changed: s.changed, epics: [], tasks: [], source: "aad" });
  for (const e of bundle.epics) {
    for (const sys of e.systems) {
      const row = rows.get(sys) ?? { system: sys, status: "From epics", change: "", changed: true, epics: [], tasks: [], source: "epics" as const };
      if (!row.epics.includes(e)) row.epics.push(e);
      rows.set(sys, row);
    }
  }
  for (const t of bundle.tasks) {
    const row = rows.get(t.repo) ?? { system: t.repo, status: "From the plan", change: "", changed: true, epics: [], tasks: [], source: "plan" as const };
    row.tasks.push(t);
    rows.set(t.repo, row);
  }
  for (const t of extraTasks) if (!rows.has(t.repo)) rows.set(t.repo, { system: t.repo, status: "From the plan", change: "", changed: true, epics: [], tasks: [], source: "plan" });
  return [...rows.values()].sort((a, b) => Number(b.changed) - Number(a.changed));
}

export function SystemRepoMap({ bundle }: { bundle: ProjectBundle }) {
  const [showAll, setShowAll] = useState(false);
  const rows = systemRows(bundle);
  const changed = rows.filter((r) => r.changed);
  const unchanged = rows.filter((r) => !r.changed);
  const shown = showAll ? rows : changed;
  if (rows.length === 0) return null;
  return (
    <SectionCard
      density="dense"
      title="Systems and repos"
      description="Read-only. From the AAD's system changes and the epics; tasks are planned per repo."
      actions={
        unchanged.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            aria-expanded={showAll}
            className="inline-flex h-8 items-center rounded-[12px] bg-well px-3 text-[13px] text-heading hover:bg-well-hover focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {showAll ? "Hide unchanged" : `+${unchanged.length} unchanged`}
          </button>
        ) : null
      }
      flush
    >
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-sm">
          <thead className="text-left text-[13px] text-muted-foreground">
            <tr className="h-11 border-y border-rule">
              <th scope="col" className="w-56 px-5 py-2 font-normal">
                System
              </th>
              <th scope="col" className="px-3 py-2 font-normal">
                Change (AAD)
              </th>
              <th scope="col" className="w-48 px-3 py-2 font-normal">
                Repo
              </th>
              <th scope="col" className="w-32 px-5 py-2 text-right font-normal whitespace-nowrap">
                Epics · tasks
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.system} className={cn("h-12 border-b border-rule align-top transition-colors last:border-b-0 hover:bg-foreground/[0.025]", !r.changed && "text-muted-foreground")}>
                <th scope="row" className="px-5 py-3 text-left font-medium text-heading">
                  <div className="flex flex-col gap-0.5">
                    <span className={cn(isRepoName(r.system) && "font-mono text-xs")}>{r.system}</span>
                    <span className="text-xs font-normal text-muted-foreground">{r.status}</span>
                  </div>
                </th>
                <td className="px-3 py-3 text-[13px] leading-5">
                  <span className="line-clamp-2" title={r.change || undefined}>
                    {r.change || <span className="text-muted-foreground">-</span>}
                  </span>
                </td>
                <td className="px-3 py-3">{isRepoName(r.system) ? <RepoChip repo={r.system} /> : <span className="text-[13px] text-muted-foreground">No code repo</span>}</td>
                <td className="px-5 py-3 text-right text-[13px] tabular-nums">
                  {r.epics.length} · {r.tasks.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
