import "server-only";
/**
 * Home dashboard read model: KPIs, the per-stage pipeline, a 14-day spend series from run
 * budgets, the top of the inbox, recent activity and project summaries.
 */
import { STAGES, type Activity, type DashboardData, type InboxItem, type ProjectSummary } from "@/lib/delivery/types";
import type { ProjectView } from "./derive";
import { isAgentActive, isInFlight } from "./rules";
import type { ProjectData, Snapshot } from "./state";

const DAY = 24 * 3600_000;

function dayKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function buildDashboard(
  entries: Array<{ pd: ProjectData; view: ProjectView }>,
  summaries: ProjectSummary[],
  inbox: InboxItem[],
  activity: Activity[],
  snap: Snapshot,
): DashboardData {
  const runs = [...snap.runs.values()];
  const today = startOfDay(snap.now);
  const spend30d = runs.filter((r) => r.createdAt >= snap.now - 30 * DAY).reduce((s, r) => s + (r.spend?.usd ?? 0), 0);

  const series: DashboardData["spendSeries"] = [];
  for (let i = 13; i >= 0; i--) {
    const from = today - i * DAY;
    const key = dayKey(from + 12 * 3600_000);
    const day = runs.filter((r) => dayKey(r.createdAt) === key);
    series.push({ date: key, usd: Math.round(day.reduce((s, r) => s + (r.spend?.usd ?? 0), 0) * 100) / 100, runs: day.length });
  }

  const pipeline = STAGES.map((def) => {
    const row = { stage: def.id, total: 0, inProgress: 0, needsInput: 0, inReview: 0, approved: 0 };
    for (const { view } of entries) {
      const status = view.stages[def.id].status;
      if (status === "locked") continue;
      row.total++;
      if (status === "in_progress") row.inProgress++;
      else if (status === "needs_input" || status === "failed") row.needsInput++;
      else if (status === "in_review") row.inReview++;
      else if (status === "approved") row.approved++;
    }
    return row;
  });

  return {
    kpis: {
      activeProjects: entries.filter((e) => !e.pd.project.done).length,
      doneProjects: entries.filter((e) => e.pd.project.done).length,
      waitingOnPeople: inbox.filter((i) => i.tier !== "fyi").length,
      runsToday: runs.filter((r) => r.createdAt >= today).length,
      agentsRunning: runs.filter((r) => isAgentActive(r.status)).length,
      spend30d: Math.round(spend30d * 100) / 100,
      tasksInFlight: entries.reduce((n, e) => n + e.pd.tasks.filter(isInFlight).length, 0),
    },
    pipeline,
    spendSeries: series,
    attention: inbox.slice(0, 6),
    activity: activity.slice(0, 20),
    projects: summaries,
  };
}
