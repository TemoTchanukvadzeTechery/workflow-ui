"use client";

/** Home KPI tiles: active projects, waiting on people, runs today, agents running now, 30-day spend. */
import { Activity, Bot, CircleDollarSign, FolderKanban, Hand } from "lucide-react";
import { KpiTile, Money, StatusDot } from "@/components/common";
import type { DashboardData } from "@/lib/delivery/types";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";

/** 2 columns on phones, 3 + 2 on medium widths, one row of five on wide screens. */
const THIRD = "@3xl:col-span-2 @5xl:col-span-1";
const HALF = "@3xl:col-span-3 @5xl:col-span-1";

export function KpiRow({ kpis, blocking, className }: { kpis: DashboardData["kpis"]; blocking: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-4 @3xl:grid-cols-6 @5xl:grid-cols-5", className)}>
      <KpiTile label="Active projects" value={kpis.activeProjects} icon={FolderKanban} href="/projects" className={THIRD} hint={`${kpis.doneProjects} done · ${plural(kpis.tasksInFlight, "task")} in flight`} />
      <KpiTile label="Waiting on people" value={kpis.waitingOnPeople} icon={Hand} href="/inbox" className={THIRD} hint={blocking > 0 ? `${blocking} holding a run` : "No run is paused"} />
      <KpiTile label="Agent runs today" value={kpis.runsToday} icon={Activity} href="/runs" className={THIRD} hint="po-brd, architect-aad, dev and QA agents" />
      <KpiTile
        label="Agents running now"
        value={
          <span className="inline-flex items-center gap-3">
            {kpis.agentsRunning}
            {kpis.agentsRunning > 0 ? <StatusDot tone="running" pulse size="lg" label="Live" /> : null}
          </span>
        }
        icon={Bot}
        href="/runs"
        className={HALF}
        hint={kpis.agentsRunning > 0 ? "Live: steps tick and cost accrues" : "All agents idle or waiting"}
      />
      <KpiTile label="Spend, 30 days" value={<Money usd={kpis.spend30d} />} icon={CircleDollarSign} hint="Sum of agent run costs" className={cn(HALF, "col-span-2")} />
    </div>
  );
}
