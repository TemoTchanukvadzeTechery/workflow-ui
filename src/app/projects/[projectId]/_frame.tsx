"use client";

/**
 * The compact header on every project page: name, key, health (with why, when not on track),
 * Done badge, the summary on the overview, and one tab row (Overview + the five stages, each with
 * its status dot) that is the project's only stage navigation. Stage, task and document pages
 * render their own h1; only the overview uses the project name as its h1.
 */
import { BadgeCheck, Compass, FolderKanban } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { actorText, EmptyState, ErrorState, HealthPill, IdChip, StatusDot, StatusPill } from "@/components/common";
import { taskSection } from "@/components/shell/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { useProject } from "@/lib/api/queries";
import { isStageId, STAGES, type DocumentKind, type ProjectBundle, type StageId } from "@/lib/delivery/types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { stageStatusMeta } from "@/lib/weft/labels";

type Section = "overview" | StageId | null;

const DOC_STAGE: Partial<Record<DocumentKind, StageId>> = { brd: "requirements", aad: "architecture", plan: "implementation", "ready-for-test": "implementation" };

/** Which tab a pathname belongs to: stages by slug, task pages under Implementation or QA (where the task is), docs by kind. */
function sectionOf(pathname: string, base: string, bundle: ProjectBundle | undefined): Section {
  if (pathname === base || pathname === `${base}/`) return "overview";
  const [a, b] = pathname.slice(base.length + 1).split("/");
  if (a && isStageId(a)) return a;
  if (a === "tasks") return b ? taskSection(bundle, decodeURIComponent(b)) : "implementation";
  if (a === "docs" && b) {
    const kind = bundle?.documents.find((d) => d.id === decodeURIComponent(b))?.kind;
    return kind ? (DOC_STAGE[kind] ?? null) : null;
  }
  return null;
}

function doneBy(bundle: ProjectBundle): string | undefined {
  const d = [...bundle.project.stages.signoff.decisions].reverse().find((x) => x.decision === "approved");
  return d ? actorText(d.by) : undefined;
}

export function ProjectFrame({ projectId, children }: { projectId: string; children: ReactNode }) {
  const pathname = usePathname();
  const q = useProject(projectId);
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const bundle = q.data;

  if (q.error instanceof ApiError && q.error.status === 404) {
    return (
      <div className="card-surface rounded-2xl">
        <EmptyState
          icon={Compass}
          title="Project not found"
          body={`No project with the id "${projectId}". It may have been deleted, or the demo data was reset.`}
          action={
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/projects">
                <FolderKanban aria-hidden />
                All projects
              </Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (q.error && !bundle) {
    return (
      <div className="card-surface rounded-2xl">
        <ErrorState title="Could not load the project" error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }

  const section = sectionOf(pathname, base, bundle);
  const overview = section === "overview";
  const TitleTag = overview ? "h1" : "p";

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", overview ? "gap-6" : "gap-4")}>
      <header className={cn("flex min-w-0 flex-col", overview ? "gap-4" : "gap-2")}>
        {!bundle ? (
          <FrameSkeleton overview={overview} />
        ) : (
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              {/* Stage, task and document pages carry their own h1, so the project name steps down there. */}
              <TitleTag className={cn("min-w-0 font-normal tracking-[-0.015em] text-foreground", overview ? "text-[22px] leading-7 sm:text-[26px] sm:leading-8" : "text-[17px] leading-6")}>
                {overview ? (
                  bundle.project.name
                ) : (
                  <Link href={base} className="underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none">
                    {bundle.project.name}
                  </Link>
                )}
              </TitleTag>
              <IdChip id={bundle.project.key} size="sm" copy={false} />
              {/* A done project's health says nothing new; the Done badge carries it. */}
              {!bundle.project.done ? <HealthPill health={bundle.health} reason={bundle.healthReason} /> : null}
              {bundle.project.done ? (
                <StatusPill
                  tone="success"
                  icon={BadgeCheck}
                  size="sm"
                  label={`Done · accepted by ${doneBy(bundle) ?? "the Product Owner"}${bundle.project.doneAt ? ` on ${formatDate(bundle.project.doneAt)}` : ""}`}
                  className="max-w-full"
                />
              ) : null}
            </div>
            {overview && bundle.project.summary ? <p className="max-w-3xl text-[13px] text-muted-foreground">{bundle.project.summary}</p> : null}
          </div>
        )}

        <nav aria-label="Project sections" className="-mx-4 overflow-x-auto border-b px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          <ul className="flex min-w-max items-end gap-1">
            <FrameTab href={base} active={section === "overview"}>
              Overview
            </FrameTab>
            {STAGES.map((s) => {
              const status = bundle?.stages[s.id]?.status;
              const meta = status ? stageStatusMeta(status) : undefined;
              return (
                <FrameTab key={s.id} href={`${base}/${s.id}`} active={section === s.id} muted={status === "locked"}>
                  {meta ? <StatusDot tone={meta.tone} pulse={meta.pulse} size="sm" /> : <span aria-hidden className="size-1.5 rounded-full bg-muted" />}
                  <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums">{s.n}</span>
                  {s.title}
                  {meta ? <span className="sr-only">({meta.label})</span> : null}
                </FrameTab>
              );
            })}
          </ul>
        </nav>
      </header>
      {children}
    </div>
  );
}

function FrameTab({ href, active, muted, children }: { href: string; active: boolean; muted?: boolean; children: ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative inline-flex h-10 items-center gap-1.5 rounded-t-lg px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          active ? "text-foreground after:absolute after:inset-x-2 after:bottom-[-1px] after:h-0.5 after:rounded-full after:bg-primary" : muted ? "text-muted-foreground/70 hover:text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {children}
      </Link>
    </li>
  );
}

function FrameSkeleton({ overview }: { overview: boolean }) {
  return (
    <div className="min-w-0 space-y-2" aria-busy="true" aria-label="Loading the project">
      <div className="flex items-center gap-2">
        <Skeleton className={cn("w-80 max-w-[70%]", overview ? "h-7" : "h-5")} />
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      {overview ? <Skeleton className="h-4 w-96 max-w-full" /> : null}
    </div>
  );
}
