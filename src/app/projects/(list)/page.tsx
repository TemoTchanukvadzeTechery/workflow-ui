import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/common";
import { ProjectsView } from "./_view";

export const metadata: Metadata = { title: "Projects" };

/** The view reads ?stage= (links from the Home pipeline), hence the Suspense boundary. */
export default function ProjectsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ProjectsView />
    </Suspense>
  );
}
