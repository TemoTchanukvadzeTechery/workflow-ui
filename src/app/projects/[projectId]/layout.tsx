import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getRuntime } from "@/server/runtime";
import { ProjectFrame } from "./_frame";

type Params = { projectId: string };

/**
 * Server-side name lookup for titles and a real 404. `undefined` means the lookup itself failed
 * (the client frame then decides from the API response); `null` means no such project.
 */
async function lookupProject(projectId: string): Promise<{ name: string; key: string } | null | undefined> {
  try {
    const rt = getRuntime();
    await rt.ready;
    const pd = rt.store.find(projectId);
    return pd ? { name: pd.project.name, key: pd.project.key } : null;
  } catch {
    return undefined;
  }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { projectId } = await params;
  const p = await lookupProject(projectId);
  if (p === null) return { title: "Project not found" };
  if (!p) return {};
  // The overview gets "<name> · Wefty"; child pages "<Stage> · <name> · Wefty".
  return { title: { default: p.name, template: `%s · ${p.name} · Wefty` } };
}

export default async function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<Params> }) {
  const { projectId } = await params;
  if ((await lookupProject(projectId)) === null) notFound();
  return <ProjectFrame projectId={projectId}>{children}</ProjectFrame>;
}
