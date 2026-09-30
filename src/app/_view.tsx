"use client";

/**
 * Home, laid out like the reference overview. Row 1: the pipeline funnel with the prompt band,
 * and agent spend by stage. Row 2: spend per day, agent runs and human decisions per weekday, and
 * the rotating insights. Row 3: what needs attention and recent activity; then the projects
 * table. The period switch in the header (7, 14 or 30 days) drives every chart. Everything is
 * live: SSE invalidates the queries as runs progress.
 */
import { ArrowRight, FolderKanban, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { EmptyState, ErrorState, SectionCard } from "@/components/common";
import { ActivityFeed, AgentSpendCard, AttentionCard, CardMenu, DotsCard, GreetingHeader, InsightsCard, PipelineCard, SpendPerDayCard } from "@/components/dashboard";
import { computeHomeMetrics, parseDay, startOfDay, type PeriodDays } from "@/components/dashboard/metrics";
import { orderByGroup } from "@/components/inbox/bits";
import { ProjectCard, ProjectsTable } from "@/components/project-list";
import { openCommandPalette } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PromptBand, type PromptSuggestion } from "@/components/viz";
import { useNow } from "@/hooks/use-now";
import { useActivity, useDashboard, useInbox, useRuns } from "@/lib/api/queries";
import type { DashboardData } from "@/lib/delivery/types";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";

/** How many project cards Home shows on phones before the "All projects" link. */
const PHONE_PROJECTS = 3;

/** "/ambassador-agreement" from "Ambassador Agreement Acceptance Reporting": a short, typeable token. */
function projectToken(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return `/${words.slice(0, 2).join("-")}`;
}

function suggestionsFor(d: DashboardData): PromptSuggestion[] {
  const out: PromptSuggestion[] = [{ token: "/inbox", label: `Open the inbox: ${plural(d.kpis.waitingOnPeople, "item")} waiting`, href: "/inbox" }];
  const top = d.attention[0];
  if (top) out.push({ token: projectToken(top.projectName), label: `Open ${top.projectName}`, href: `/projects/${encodeURIComponent(top.projectId)}` });
  out.push({ token: "/new project", label: "Start a new project", href: "/projects/new" });
  return out;
}

export function HomeView() {
  const q = useDashboard();
  const runs = useRuns({ limit: 1000 });
  const activity = useActivity({ limit: 500 });
  const inbox = useInbox();
  const [period, setPeriod] = useState<PeriodDays>(14);
  const now = useNow(60_000);
  const d = q.data;

  // "Today" is the server's current day (the last point of its 14-day series), so a demo clock
  // and the browser agree; before the dashboard loads, the browser's day.
  const lastDay = d?.spendSeries.at(-1)?.date;
  const today = lastDay ? parseDay(lastDay) : startOfDay(now);
  const metrics = useMemo(
    () => (runs.data && activity.data ? computeHomeMetrics(runs.data, activity.data, period, today) : undefined),
    [runs.data, activity.data, period, today],
  );
  const metricsError = runs.error ?? activity.error;

  const summary = d ? (
    <>
      {plural(d.kpis.activeProjects, "active project")} · {plural(d.kpis.waitingOnPeople, "thing", "things")} waiting on people · {plural(d.kpis.agentsRunning, "agent")} running now
    </>
  ) : null;

  return (
    <div className="@container flex min-w-0 flex-col gap-6 lg:gap-7">
      <GreetingHeader summary={summary} period={period} onPeriodChange={setPeriod} today={today} />
      {q.isPending ? (
        <HomeSkeleton />
      ) : q.error || !d ? (
        <SectionCard>
          <ErrorState title="Could not load the dashboard" error={q.error} onRetry={() => void q.refetch()} />
        </SectionCard>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 @3xl:grid-cols-2 @6xl:grid-cols-12">
          <PipelineCard
            pipeline={d.pipeline}
            projects={d.projects}
            className="@3xl:col-span-2 @6xl:col-span-8"
            footer={<PromptBand title="What would you like to do next?" placeholder="Search projects, requests and runs, or type a command" suggestions={suggestionsFor(d)} onSubmit={(text) => openCommandPalette(text)} />}
          />
          {metricsError ? (
            <SectionCard className="@3xl:col-span-2 @6xl:col-span-4">
              <ErrorState
                title="Could not load runs and activity"
                error={metricsError}
                onRetry={() => {
                  void runs.refetch();
                  void activity.refetch();
                }}
              />
            </SectionCard>
          ) : (
            <>
              <AgentSpendCard metrics={metrics} className="@6xl:col-span-4" />
              <SpendPerDayCard metrics={metrics} className="@6xl:col-span-3" />
              <div className="flex min-w-0 flex-col gap-4 @6xl:col-span-5">
                <DotsCard
                  title="Agent runs"
                  total={metrics?.runs}
                  columns={metrics?.runsByWeekday}
                  delta={metrics ? metrics.runs - metrics.prevRuns : undefined}
                  tone="green"
                  peakLabel="Peak"
                  unit="runs"
                  menu={<CardMenu href="/runs" label="Open agent runs" />}
                  className="flex-1"
                />
                <DotsCard
                  title="Human decisions"
                  total={metrics?.decisions}
                  columns={metrics?.decisionsByWeekday}
                  delta={metrics ? metrics.decisions - metrics.prevDecisions : undefined}
                  tone="blue"
                  peakLabel="Highest"
                  unit="decisions"
                  menu={<CardMenu href="/inbox" label="Open the inbox" />}
                  className="flex-1"
                />
              </div>
              <InsightsCard metrics={metrics} inbox={inbox.data} now={now} className="min-h-[340px] @6xl:col-span-4" />
            </>
          )}

          <AttentionCard count={d.kpis.waitingOnPeople} items={inbox.data ? orderByGroup(inbox.data.filter((i) => i.tier !== "fyi")) : d.attention} className="@3xl:col-span-2 @6xl:col-span-8" />
          {/* No fixed height: a clipped list cut entries mid-line. "Show more" grows it instead. */}
          <SectionCard title="Activity" cardMenu={<CardMenu href="/inbox" label="Open the inbox" />} className="@3xl:col-span-2 @6xl:col-span-4">
            <ActivityFeed items={d.activity} projects={Object.fromEntries(d.projects.map((p) => [p.id, { name: p.name, key: p.key }]))} initial={6} emptyText="Nothing has happened yet." />
          </SectionCard>

          <SectionCard
            title="Projects"
            description={`${plural(d.projects.length, "project")}, most recently updated first`}
            cardMenu={<CardMenu href="/projects" label="All projects" />}
            flush
            className="@3xl:col-span-2 @6xl:col-span-12"
          >
            {d.projects.length === 0 ? (
              <EmptyState
                icon={FolderKanban}
                title="No projects yet"
                body="Start one from a Product Owner request, or import an existing BRD."
                action={
                  <Button asChild>
                    <Link href="/projects/new">
                      <Plus aria-hidden />
                      New project
                    </Link>
                  </Button>
                }
              />
            ) : (
              <>
                {/* Phones: the three most recent as cards, then a link to the full list (seven cards made Home 7,000px tall). */}
                <div className="grid gap-3 px-4 pb-4 sm:hidden">
                  {d.projects.slice(0, PHONE_PROJECTS).map((p) => (
                    <ProjectCard key={p.id} project={p} />
                  ))}
                  {d.projects.length > PHONE_PROJECTS ? (
                    <Button asChild variant="secondary" className="h-11 justify-between px-4.5">
                      <Link href="/projects">
                        All {d.projects.length} projects
                        <ArrowRight aria-hidden />
                      </Link>
                    </Button>
                  ) : null}
                </div>
                <ProjectsTable rows={d.projects} className="hidden sm:table" />
              </>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}

function CardShell({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={cn("card-surface flex flex-col gap-5 rounded-[28px] p-5 sm:p-7", className)} aria-hidden>
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="size-11 rounded-full" />
      </div>
      {children}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2 @6xl:grid-cols-12" aria-busy="true" aria-label="Loading the dashboard">
      <CardShell className="@3xl:col-span-2 @6xl:col-span-8">
        <div className="grid grid-cols-5 items-end gap-2">
          {[80, 64, 50, 38, 26].map((h, i) => (
            <Skeleton key={i} className="rounded-none" style={{ height: `${h * 2.6}px` }} />
          ))}
        </div>
        <Skeleton className="h-24 w-full rounded-[20px]" />
      </CardShell>
      <CardShell className="@6xl:col-span-4">
        <Skeleton className="h-16 w-48" />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </CardShell>
      <CardShell className="@6xl:col-span-3">
        <Skeleton className="h-60 w-full" />
      </CardShell>
      <div className="flex flex-col gap-4 @6xl:col-span-5">
        <CardShell className="flex-1">
          <Skeleton className="h-14 w-full" />
        </CardShell>
        <CardShell className="flex-1">
          <Skeleton className="h-14 w-full" />
        </CardShell>
      </div>
      <Skeleton className="min-h-[340px] rounded-[28px] @6xl:col-span-4" />
    </div>
  );
}
