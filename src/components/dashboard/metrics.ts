/**
 * Home's period metrics, computed in the browser from the runs list (with spend) and the activity
 * log, so the period switch (7, 14 or 30 days) can drive every chart. Each figure also has the
 * previous period of the same length, for the "vs last period" deltas.
 */
import { STAGES, type Activity, type ActivityType, type StageId } from "@/lib/delivery/types";
import type { RunRow } from "@/lib/weft/types";

export type PeriodDays = 7 | 14 | 30;
export const PERIODS: readonly PeriodDays[] = [7, 14, 30];

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const DAY = 24 * 3600_000;

/** Human activity that is a decision: an answer, an approval, an acceptance or a change request. */
const DECISIONS: ReadonlySet<ActivityType> = new Set<ActivityType>([
  "human.answered",
  "artifact.accepted",
  "epic.accepted",
  "plan.approved",
  "task.approved",
  "task.changes_requested",
  "qa.verdict",
  "stage.approved",
  "stage.changes_requested",
  "project.done",
]);
const APPROVALS: ReadonlySet<ActivityType> = new Set<ActivityType>(["artifact.accepted", "epic.accepted", "plan.approved", "task.approved", "stage.approved", "project.done"]);
const CHANGE_REQUESTS: ReadonlySet<ActivityType> = new Set<ActivityType>(["task.changes_requested", "stage.changes_requested"]);

/** The stages that run agents, in order (PO Review has no workflow). */
export const SPEND_STAGES: readonly StageId[] = STAGES.filter((s) => s.workflows.length > 0).map((s) => s.id);

const STAGE_OF_WORKFLOW = new Map<string, StageId>(STAGES.flatMap((s) => s.workflows.map((w) => [w, s.id] as const)));

export interface DayPoint {
  /** "2026-09-17", a local calendar day. */
  date: string;
  /** Start of the day, epoch ms. */
  at: number;
  usd: number;
  runs: number;
}

export interface HomeMetrics {
  period: PeriodDays;
  /** One point per day of the period, oldest first. */
  days: DayPoint[];
  spend: number;
  prevSpend: number;
  spendByStage: Array<{ stage: StageId; usd: number; runs: number }>;
  runs: number;
  prevRuns: number;
  /** Agent runs started per weekday (Mon..Sun) in the period. */
  runsByWeekday: number[];
  /** Runs of the period by outcome. */
  finished: number;
  failed: number;
  /** Human decisions (answers, approvals, change requests, verdicts) in the period. */
  decisions: number;
  prevDecisions: number;
  decisionsByWeekday: number[];
  approvals: number;
  changeRequests: number;
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "2026-09-16" as local midnight. */
export function parseDay(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Monday = 0 ... Sunday = 6. */
function weekday(ms: number): number {
  return (new Date(ms).getDay() + 6) % 7;
}

/**
 * Metrics for the `period` days ending with `today` (local midnight of the server's current day,
 * so a virtual demo clock and the browser agree on which day is "today").
 */
export function computeHomeMetrics(runs: readonly RunRow[], activity: readonly Activity[], period: PeriodDays, today: number): HomeMetrics {
  const end = today + DAY;
  const from = today - (period - 1) * DAY;
  const prevFrom = from - period * DAY;
  const inPeriod = (at: number) => at >= from && at < end;
  const inPrev = (at: number) => at >= prevFrom && at < from;
  const usdOf = (r: RunRow) => r.spend?.usd ?? 0;

  const days: DayPoint[] = Array.from({ length: period }, (_, i) => {
    const at = startOfDay(from + i * DAY + 12 * 3600_000);
    return { date: dayKey(at), at, usd: 0, runs: 0 };
  });
  const byKey = new Map(days.map((d) => [d.date, d]));

  const byStage = new Map<StageId, { usd: number; runs: number }>(SPEND_STAGES.map((s) => [s, { usd: 0, runs: 0 }]));
  const runsByWeekday = Array.from({ length: 7 }, () => 0);
  let spend = 0;
  let prevSpend = 0;
  let count = 0;
  let prevCount = 0;
  let finished = 0;
  let failed = 0;

  for (const r of runs) {
    if (inPeriod(r.createdAt)) {
      const usd = usdOf(r);
      spend += usd;
      count++;
      runsByWeekday[weekday(r.createdAt)]++;
      const day = byKey.get(dayKey(r.createdAt));
      if (day) {
        day.usd += usd;
        day.runs++;
      }
      const stage = STAGE_OF_WORKFLOW.get(r.workflow);
      const row = stage ? byStage.get(stage) : undefined;
      if (row) {
        row.usd += usd;
        row.runs++;
      }
      if (r.status === "complete") finished++;
      else if (r.status === "failed") failed++;
    } else if (inPrev(r.createdAt)) {
      prevSpend += usdOf(r);
      prevCount++;
    }
  }
  for (const d of days) d.usd = Math.round(d.usd * 100) / 100;

  const decisionsByWeekday = Array.from({ length: 7 }, () => 0);
  let decisions = 0;
  let prevDecisions = 0;
  let approvals = 0;
  let changeRequests = 0;
  for (const a of activity) {
    if (a.actor.kind !== "human" || !DECISIONS.has(a.type)) continue;
    if (inPeriod(a.at)) {
      decisions++;
      decisionsByWeekday[weekday(a.at)]++;
      if (APPROVALS.has(a.type)) approvals++;
      else if (CHANGE_REQUESTS.has(a.type)) changeRequests++;
    } else if (inPrev(a.at)) {
      prevDecisions++;
    }
  }

  return {
    period,
    days,
    spend: Math.round(spend * 100) / 100,
    prevSpend: Math.round(prevSpend * 100) / 100,
    spendByStage: SPEND_STAGES.map((stage) => ({ stage, ...(byStage.get(stage) ?? { usd: 0, runs: 0 }) })),
    runs: count,
    prevRuns: prevCount,
    runsByWeekday,
    finished,
    failed,
    decisions,
    prevDecisions,
    decisionsByWeekday,
    approvals,
    changeRequests,
  };
}

/** "+12", "-3", "0". */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** Relative change as a whole percent, or undefined when there is nothing to compare with. */
export function percentChange(now: number, before: number): number | undefined {
  if (before <= 0) return undefined;
  return Math.round(((now - before) / before) * 100);
}

/** Middle value of a list of numbers (0 for none). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
