"use client";

/**
 * Epics at a glance: Jira key (once "Create in Jira" ran), title, status, whether Architecture
 * changed it, and delivery progress from its tasks (solid = approved, hatched = in flight).
 */
import { Layers } from "lucide-react";
import Link from "next/link";
import { EmptyState, HatchedBar, IdChip, SectionCard, StatusPill } from "@/components/common";
import type { DeliveryTask, Epic, ProjectBundle } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { CardMenu } from "../dashboard/CardMenu";

const IN_FLIGHT = new Set<DeliveryTask["status"]>(["in_progress", "verifying", "in_review", "changes_requested"]);

function Progress({ tasks, planApproved }: { tasks: DeliveryTask[]; planApproved: boolean }) {
  const live = tasks.filter((t) => t.status !== "cancelled");
  if (live.length === 0) return <span className="text-[13px] text-muted-foreground">{planApproved ? "No tasks" : "Tasks come with the plan"}</span>;
  const done = live.filter((t) => t.status === "done").length;
  const partial = live.filter((t) => IN_FLIGHT.has(t.status)).length;
  return (
    <span className="flex items-center gap-2">
      <HatchedBar done={done} partial={partial} total={live.length} size="md" className="w-24" label={`${done} of ${live.length} tasks approved, ${partial} in flight`} />
      <span className="text-[13px] text-muted-foreground tabular-nums">
        {done}/{live.length}
      </span>
    </span>
  );
}

function EpicRow({ epic, tasks, planApproved, href }: { epic: Epic; tasks: DeliveryTask[]; planApproved: boolean; href: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-5 py-3.5 sm:px-7 @2xl:grid-cols-[100px_minmax(0,1fr)_auto_150px]">
      <span className="order-1 @2xl:order-none">
        {epic.key ? (
          <IdChip id={epic.key} size="sm" />
        ) : (
          <span className="flex flex-col font-mono text-xs leading-4 text-muted-foreground" title="Not created in Jira yet">
            {epic.id}
            <span className="font-sans text-xs">Not in Jira yet</span>
          </span>
        )}
      </span>
      <span className="order-3 col-span-2 min-w-0 @2xl:order-none @2xl:col-span-1">
        <Link href={href} className="line-clamp-2 text-sm leading-5 text-heading underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none">
          {epic.title}
        </Link>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {epic.brdRequirementRefs.length ? <span className="font-mono">{epic.brdRequirementRefs.join(" ")}</span> : null}
          {epic.aadRefs.length ? <span className="font-mono">{epic.aadRefs.join(" ")}</span> : null}
          {epic.changedIn === "architecture" ? <span className="rounded-full bg-well px-2 leading-5">Changed in Architecture</span> : null}
          {epic.blockedBy?.length ? <span className="text-status-attention-fg">Blocked by {epic.blockedBy.join(", ")}</span> : null}
        </span>
      </span>
      <span className="order-2 justify-self-end @2xl:order-none @2xl:justify-self-start">
        <StatusPill status={{ kind: "epic", value: epic.status }} size="sm" />
      </span>
      <span className="order-4 col-span-2 @2xl:col-span-1">
        <Progress tasks={tasks} planApproved={planApproved} />
      </span>
    </div>
  );
}

export function EpicsSummary({ bundle, className }: { bundle: ProjectBundle; className?: string }) {
  const { project, epics, tasks } = bundle;
  const base = `/projects/${encodeURIComponent(project.id)}`;
  const epicsStage = project.currentStage === "architecture" ? "architecture" : "requirements";
  const href = `${base}/${epicsStage}?step=epics`;
  const synced = epics.filter((e) => e.status === "synced").length;
  const planApproved = !!project.stages.implementation.planApprovedAt;

  return (
    <SectionCard
      title="Epics"
      description={epics.length ? `${epics.length} epics · ${synced} created in Jira (mock)` : "Proposed from the accepted BRD"}
      cardMenu={epics.length ? <CardMenu href={href} label="Open epics" /> : undefined}
      flush
      className={cn("@container", className)}
    >
      {epics.length === 0 ? (
        <EmptyState size="sm" icon={Layers} title="No epics yet" body="po-brd proposes epics from the BRD; you accept them, then create them in Jira." className="border-t border-rule" />
      ) : (
        <ul className="divide-y divide-rule border-t border-rule">
          {epics.map((e) => (
            <li key={e.id}>
              <EpicRow epic={e} tasks={tasks.filter((t) => t.epicId === e.id)} planApproved={planApproved} href={href} />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
