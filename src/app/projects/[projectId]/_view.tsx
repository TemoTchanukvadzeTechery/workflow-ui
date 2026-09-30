"use client";

/**
 * Project overview: the large stage stepper, the one loud "Next step" card, what needs a person
 * on this project (answerable inline), KPIs, documents, epics, the decisions log and activity.
 * The project header, 404 and load errors come from the frame (layout.tsx).
 */
import { SectionCard } from "@/components/common";
import { ActivityFeed } from "@/components/dashboard";
import { DecisionsLog, DocumentsCard, EpicsSummary, NextStepCard, OverviewSkeleton, ProjectAttention, ProjectKpis } from "@/components/overview";
import { StageStepper } from "@/components/stage";
import { useProject } from "@/lib/api/queries";

export function ProjectOverviewView({ projectId }: { projectId: string }) {
  const { data: bundle } = useProject(projectId);
  if (!bundle) return <OverviewSkeleton />;

  return (
    <div className="@container flex min-w-0 flex-col gap-4">
      <StageStepper projectId={projectId} stages={bundle.stages} current={bundle.project.currentStage} done={bundle.project.done} variant="large" />

      <div className="grid min-w-0 gap-4 @5xl:grid-cols-3">
        <NextStepCard bundle={bundle} />
        <ProjectAttention bundle={bundle} className="@5xl:col-span-2" />
      </div>

      <ProjectKpis bundle={bundle} />

      <div className="grid min-w-0 gap-4 @5xl:grid-cols-12">
        <DocumentsCard bundle={bundle} className="@5xl:col-span-5" />
        <EpicsSummary bundle={bundle} className="@5xl:col-span-7" />
      </div>

      <div className="grid min-w-0 gap-4 @5xl:grid-cols-2">
        <DecisionsLog bundle={bundle} />
        {/* No fixed height: a clipped list cut entries mid-line. "Show more" grows it instead. */}
        <SectionCard title="Activity" description="People and agents on this project">
          <ActivityFeed items={bundle.activity} initial={8} emptyText="Nothing has happened on this project yet." />
        </SectionCard>
      </div>
    </div>
  );
}
