import { ProjectOverviewView } from "./_view";

/** Title: the layout's generateMetadata gives the overview the bare project name. */
export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectOverviewView projectId={projectId} />;
}
