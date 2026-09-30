"use client";

/**
 * The one loud card on Home: a few computed insights rotating on the mesh gradient. What waits on
 * people comes first (it is the actionable one), then how long it has waited, how reviews ended
 * and how agent runs ended over the period.
 */
import { MeshInsightCard, type InsightItem } from "@/components/viz";
import { Skeleton } from "@/components/ui/skeleton";
import { stageDef, type InboxItem } from "@/lib/delivery/types";
import { formatDuration, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { itemSince } from "../inbox/bits";
import { median, type HomeMetrics } from "./metrics";

/** "45m", "15h", "3d": short enough for the 72px numeral. */
function shortWait(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

export function buildInsights(metrics: HomeMetrics, inbox: InboxItem[], now: number): InsightItem[] {
  const out: InsightItem[] = [];
  const waiting = inbox.filter((i) => i.tier !== "fyi");
  const blocking = waiting.filter((i) => i.tier === "blocking_run");

  if (waiting.length > 0) {
    const other = waiting.length - blocking.length;
    out.push({
      value: String(blocking.length),
      title: blocking.length === 1 ? "request is holding a paused agent run right now." : "requests are holding paused agent runs right now.",
      body: `${other > 0 ? `${plural(other, "more item")} ${other === 1 ? "waits" : "wait"} for an approval or a start. ` : ""}Answer them in the Inbox and the agents carry on.`,
      href: "/inbox",
    });
    const waits = waiting.map((i) => Math.max(0, now - itemSince(i)));
    const longest = waiting[waits.indexOf(Math.max(...waits))];
    out.push({
      value: shortWait(median(waits)),
      title: `median wait across ${plural(waiting.length, "item")} that need a person.`,
      body: longest ? `The longest, ${longest.projectName} in ${stageDef(longest.stage).title}, has waited ${formatDuration(Math.max(0, now - itemSince(longest)))}.` : undefined,
      href: "/inbox",
    });
  } else {
    out.push({ value: "0", title: "requests wait on a person right now.", body: "Agents keep working; new questions show up in the Inbox." });
  }

  const reviewed = metrics.approvals + metrics.changeRequests;
  if (reviewed > 0) {
    out.push({
      value: `${Math.round((metrics.approvals / reviewed) * 100)}%`,
      title: `of reviews ended in an approval over the last ${metrics.period} days.`,
      body: `${plural(metrics.approvals, "approval")} and ${plural(metrics.changeRequests, "change request")} from people. A change request sends the work back to its agent.`,
    });
  }

  const ended = metrics.finished + metrics.failed;
  if (ended > 0) {
    const open = metrics.runs - ended;
    out.push({
      value: `${Math.round((metrics.finished / ended) * 100)}%`,
      title: `of finished agent runs completed without failing in the last ${metrics.period} days.`,
      body: `${metrics.finished} complete, ${metrics.failed} failed${open > 0 ? `, ${open} still running or waiting` : ""}.`,
      href: "/runs",
    });
  }
  return out.slice(0, 4);
}

export function InsightsCard({ metrics, inbox, now, className }: { metrics?: HomeMetrics; inbox?: InboxItem[]; now: number; className?: string }) {
  if (!metrics || !inbox) return <Skeleton className={cn("min-h-[320px] rounded-[28px]", className)} aria-label="Loading insights" />;
  return <MeshInsightCard items={buildInsights(metrics, inbox, now)} className={className} />;
}
