"use client";

/**
 * Home: the portfolio bento. Row 1 pipeline + needs your attention, row 2 KPI tiles, row 3 the
 * 14-day spend/runs chart + activity, row 4 a compact projects table. Everything is live: SSE
 * invalidates the dashboard query as runs progress.
 */
import { ArrowRight, FolderKanban, Plus } from "lucide-react";
import Link from "next/link";
import { CardSkeleton, EmptyState, ErrorState, SectionCard } from "@/components/common";
import { ActivityFeed, AttentionCard, GreetingHeader, KpiRow, PipelineCard, SpendChart } from "@/components/dashboard";
import { ProjectCard, ProjectRowsSkeleton, ProjectsTable } from "@/components/project-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboard } from "@/lib/api/queries";
import { plural } from "@/lib/format";

export function HomeView() {
  const q = useDashboard();
  const d = q.data;

  const summary = d ? (
    <span>
      {plural(d.kpis.activeProjects, "active project")} · {plural(d.kpis.waitingOnPeople, "thing", "things")} waiting on people · {plural(d.kpis.agentsRunning, "agent")} running now
    </span>
  ) : q.isPending ? (
    <span aria-hidden className="inline-block h-4 w-72 max-w-full animate-pulse rounded-md bg-muted align-middle" />
  ) : null;

  return (
    <div className="@container flex flex-col gap-6">
      <GreetingHeader summary={summary} />
      {q.isPending ? (
        <HomeSkeleton />
      ) : q.error || !d ? (
        <SectionCard>
          <ErrorState title="Could not load the dashboard" error={q.error} onRetry={() => void q.refetch()} />
        </SectionCard>
      ) : (
        <>
          <div className="grid min-w-0 gap-4 @5xl:grid-cols-3">
            <PipelineCard pipeline={d.pipeline} projects={d.projects} className="@5xl:col-span-2" />
            <AttentionCard count={d.kpis.waitingOnPeople} items={d.attention} />
          </div>

          <KpiRow kpis={d.kpis} blocking={d.attention.filter((i) => i.tier === "blocking_run").length} />

          <div className="grid min-w-0 gap-4 @5xl:grid-cols-3">
            <SpendChart series={d.spendSeries} className="@5xl:col-span-2" />
            {/* No fixed height: a clipped list cut entries mid-line. "Show more" grows it instead. */}
            <SectionCard kicker="Live" title="Activity" description="People and agents, across projects">
              <ActivityFeed items={d.activity} projects={Object.fromEntries(d.projects.map((p) => [p.id, { name: p.name, key: p.key }]))} initial={6} emptyText="Nothing has happened yet." />
            </SectionCard>
          </div>

          <SectionCard
            title="Projects"
            description={`${plural(d.projects.length, "project")}, most recently updated first`}
            actions={
              <Button asChild variant="ghost" size="sm" className="rounded-full text-primary">
                <Link href="/projects">
                  All projects
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            }
            flush
          >
            {d.projects.length === 0 ? (
              <EmptyState
                icon={FolderKanban}
                title="No projects yet"
                body="Start one from a Product Owner request, or import an existing BRD."
                action={
                  <Button asChild className="rounded-full">
                    <Link href="/projects/new">
                      <Plus aria-hidden />
                      New project
                    </Link>
                  </Button>
                }
              />
            ) : (
              <>
                <div className="grid gap-3 border-t p-4 sm:hidden">
                  {d.projects.map((p) => (
                    <ProjectCard key={p.id} project={p} />
                  ))}
                </div>
                <ProjectsTable rows={d.projects} className="hidden sm:table" />
              </>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading the dashboard">
      <div className="grid gap-4 @5xl:grid-cols-3">
        <div className="card-surface flex flex-col gap-4 rounded-2xl p-5 @5xl:col-span-2" aria-hidden>
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-32" />
          <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12 rounded-xl @2xl:h-56" />
            ))}
          </div>
        </div>
        <CardSkeleton rows={7} />
      </div>
      <div className="grid grid-cols-2 gap-4 @5xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="card-surface flex flex-col gap-4 rounded-2xl p-5" aria-hidden>
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-10 w-16" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 @5xl:grid-cols-3">
        <CardSkeleton rows={8} className="@5xl:col-span-2" />
        <CardSkeleton rows={8} />
      </div>
      <div className="card-surface overflow-hidden rounded-2xl pt-5" aria-hidden>
        <Skeleton className="mx-5 mb-4 h-4 w-24" />
        <ProjectRowsSkeleton rows={5} />
      </div>
    </div>
  );
}
