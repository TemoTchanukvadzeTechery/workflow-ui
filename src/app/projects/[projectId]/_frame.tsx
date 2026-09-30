"use client";

/**
 * The header on every project page: name (a big title on the overview), key and health chips
 * (health says why when not on track), Done badge, the summary on the overview, a compact
 * five-segment striped stepper, and one segmented tab row (Overview + the five stages, each with
 * its status dot) that is the project's only stage navigation. Stage, task and document pages
 * render their own h1; only the overview uses the project name as its h1.
 */
import { BadgeCheck, Compass, FolderKanban } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { actorText, EmptyState, ErrorState, HealthPill, IdChip, SegmentBar, stageSegment, StatusDot, StatusPill } from "@/components/common";
import { taskSection } from "@/components/shell/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { useProject } from "@/lib/api/queries";
import { isStageId, stageDef, STAGES, type DocumentKind, type ProjectBundle, type StageId } from "@/lib/delivery/types";
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
      <div className="card-surface rounded-[28px]">
        <EmptyState
          icon={Compass}
          title="Project not found"
          body={`No project with the id "${projectId}". It may have been deleted, or the demo data was reset.`}
          action={
            <Button asChild variant="secondary">
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
      <div className="card-surface rounded-[28px]">
        <ErrorState title="Could not load the project" error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }

  const section = sectionOf(pathname, base, bundle);
  const overview = section === "overview";
  const TitleTag = overview ? "h1" : "p";
  const current = bundle ? stageDef(bundle.project.currentStage) : undefined;

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", overview ? "gap-6" : "gap-5")}>
      <header className={cn("flex min-w-0 flex-col", overview ? "gap-5" : "gap-4")}>
        {!bundle ? (
          <FrameSkeleton overview={overview} />
        ) : (
          <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
            <div className="min-w-0 space-y-2.5">
              <div className={cn("flex flex-wrap gap-x-3 gap-y-2", overview ? "items-start" : "items-center")}>
                {/* Stage, task and document pages carry their own h1, so the project name steps down there. */}
                <TitleTag
                  className={cn(
                    "min-w-0 font-normal break-words text-heading",
                    overview ? "text-[34px] leading-[1.1] tracking-[-0.03em] sm:text-[44px] sm:leading-[1.05] sm:tracking-[-0.035em] xl:text-[48px]" : "text-[17px] leading-6 tracking-[-0.01em]",
                  )}
                >
                  {overview ? (
                    bundle.project.name
                  ) : (
                    <Link href={base} className="rounded-sm underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none">
                      {bundle.project.name}
                    </Link>
                  )}
                </TitleTag>
                <span className={cn("flex flex-wrap items-center gap-2", overview && "sm:pt-2.5")}>
                  <IdChip id={bundle.project.key} copy={false} className="h-7 rounded-full bg-well px-2.5 text-[13px]" />
                  {/* A done project's health says nothing new; the Done badge carries it. */}
                  {!bundle.project.done ? <HealthPill health={bundle.health} reason={bundle.healthReason} size={overview ? "md" : "sm"} /> : null}
                  {bundle.project.done ? (
                    <StatusPill
                      tone="success"
                      icon={BadgeCheck}
                      size={overview ? "md" : "sm"}
                      label={`Done · accepted by ${doneBy(bundle) ?? "the Product Owner"}${bundle.project.doneAt ? ` on ${formatDate(bundle.project.doneAt)}` : ""}`}
                      className="max-w-full"
                    />
                  ) : null}
                </span>
              </div>
              {overview && bundle.project.summary ? <p className="max-w-3xl text-[15px] leading-6 text-muted-foreground">{bundle.project.summary}</p> : null}
            </div>
            {/* The compact stepper: five striped segments, done in full stripes and the current stage lighter. */}
            <div className={cn("w-full max-w-sm shrink-0 flex-col gap-2 lg:w-72", overview ? "flex" : "hidden sm:flex")}>
              <div className="flex items-baseline justify-between gap-3 text-[13px] leading-5">
                <span className="text-muted-foreground">{bundle.project.done ? "All stages approved" : "Current stage"}</span>
                <span className="truncate text-heading">{bundle.project.done ? "Done" : `${current?.n} of 5 · ${current?.title}`}</span>
              </div>
              <SegmentBar size="lg" segments={STAGES.map((st) => stageSegment(st.id, bundle.stages[st.id]?.status))} />
            </div>
          </div>
        )}

        <nav aria-label="Project sections" className="relative -mx-5 overflow-x-auto px-5 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          <ul className="inline-flex min-w-max items-center gap-1 rounded-[16px] bg-well p-1">
            <FrameTab href={base} active={section === "overview"}>
              Overview
            </FrameTab>
            {STAGES.map((st) => {
              const status = bundle?.stages[st.id]?.status;
              const meta = status ? stageStatusMeta(status) : undefined;
              return (
                <FrameTab key={st.id} href={`${base}/${st.id}`} active={section === st.id}>
                  {meta ? <StatusDot tone={meta.tone} pulse={meta.pulse} size="md" /> : <span aria-hidden className="size-2 rounded-full bg-muted-foreground/30" />}
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{st.n}</span>
                  {st.title}
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

function FrameTab({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative inline-flex h-9 items-center gap-2 rounded-[12px] px-3.5 text-sm font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          active ? "bg-raised text-heading shadow-(--raised-shadow)" : "text-muted-foreground hover:text-heading",
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
        <Skeleton className={cn("w-96 max-w-[70%]", overview ? "h-11" : "h-6")} />
        <Skeleton className="h-7 w-14 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
      </div>
      {overview ? <Skeleton className="h-5 w-[28rem] max-w-full" /> : null}
    </div>
  );
}
