"use client";

/**
 * The header on every project page. The overview names the project (its h1) with key and health
 * chips (health says why when not on track), the Done badge and the summary. Stage, task and
 * document pages carry their own h1 and the breadcrumb names the project, so there the key and
 * health chips sit at the right end of the tab row (phones, whose breadcrumb shows only the
 * current page, keep a one-line project name). The tab row (Overview + the five stages, each
 * with its status dot) is a light text nav and the project's only stage navigation.
 */
import { BadgeCheck, Compass, FolderKanban } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
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
  const navRef = useRef<HTMLElement>(null);
  const section = sectionOf(pathname, base, bundle);

  // Where the tab row scrolls (phones, tablets), bring the current tab into view; again once the
  // project loads, since the chips beside the row then take some of its width.
  const loaded = bundle !== undefined;
  useEffect(() => {
    const nav = navRef.current;
    const tab = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !tab) return;
    const n = nav.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    if (t.left < n.left || t.right > n.right) nav.scrollLeft += t.left - n.left - (n.width - t.width) / 2;
  }, [section, loaded]);

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

  const overview = section === "overview";

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", overview ? "gap-6" : "gap-5")}>
      <header className={cn("flex min-w-0 flex-col", overview ? "gap-5" : "gap-3")}>
        {!bundle ? (
          <FrameSkeleton overview={overview} />
        ) : overview ? (
          <div className="min-w-0 space-y-2.5">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              <h1 className="min-w-0 text-[34px] leading-[1.1] font-normal tracking-[-0.03em] break-words text-heading sm:text-[44px] sm:leading-[1.05] sm:tracking-[-0.035em] xl:text-[48px]">
                {bundle.project.name}
              </h1>
              <span className="flex flex-wrap items-center gap-2 sm:pt-2.5">
                <ProjectChips bundle={bundle} size="md" />
              </span>
            </div>
            {bundle.project.summary ? <p className="max-w-3xl text-[15px] leading-6 text-muted-foreground">{bundle.project.summary}</p> : null}
          </div>
        ) : (
          // Phones: the breadcrumb keeps only the current page, so the project is named here. From
          // sm up the breadcrumb names it and the chips sit at the end of the tab row.
          <p className="flex min-w-0 items-center gap-2 sm:hidden">
            <Link href={base} className="min-w-0 truncate rounded-sm text-[15px] leading-6 text-heading underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none">
              {bundle.project.name}
            </Link>
            <ProjectChips bundle={bundle} size="sm" short />
          </p>
        )}

        <div className="flex min-w-0 items-center gap-4">
          {/* A light text nav (the stage page's sub-steps are the segmented control); py-1 keeps focus rings and the raised shadow unclipped. */}
          <nav ref={navRef} aria-label="Project sections" className="-mx-5 -my-1 min-w-0 flex-1 overflow-x-auto px-5 py-1 [scrollbar-width:none] sm:-mx-1 sm:px-1 [&::-webkit-scrollbar]:hidden">
            <ul className="flex min-w-max items-center gap-0.5">
              <FrameTab href={base} active={overview}>
                Overview
              </FrameTab>
              {STAGES.map((st) => {
                const status = bundle?.stages[st.id]?.status;
                const meta = status ? stageStatusMeta(status) : undefined;
                return (
                  <FrameTab key={st.id} href={`${base}/${st.id}`} active={section === st.id}>
                    {meta ? <StatusDot tone={meta.tone} pulse={meta.pulse} size="md" /> : <span aria-hidden className="size-2 rounded-full bg-muted-foreground/30" />}
                    <span className="text-[13px] text-muted-foreground tabular-nums">{st.n}</span>
                    {st.title}
                    {meta ? <span className="sr-only">({meta.label})</span> : null}
                  </FrameTab>
                );
              })}
            </ul>
          </nav>
          {bundle && !overview ? (
            <span className="hidden shrink-0 items-center gap-2 sm:flex">
              <ProjectChips bundle={bundle} size="sm" short />
            </span>
          ) : null}
        </div>
      </header>
      {children}
    </div>
  );
}

/** Key and health chips; a done project shows its Done badge instead of health ("short": just "Done", the rest in the tooltip). */
function ProjectChips({ bundle, size, short }: { bundle: ProjectBundle; size: "sm" | "md"; short?: boolean }) {
  const done = bundle.project.done;
  const doneLabel = `Done · accepted by ${doneBy(bundle) ?? "the Product Owner"}${bundle.project.doneAt ? ` on ${formatDate(bundle.project.doneAt)}` : ""}`;
  return (
    <>
      <IdChip id={bundle.project.key} copy={false} className={cn("shrink-0 rounded-full bg-well text-[13px]", size === "md" ? "h-7 px-2.5" : "h-6 px-2")} />
      {/* A done project's health says nothing new; the Done badge carries it. */}
      {done ? (
        <StatusPill tone="success" icon={BadgeCheck} size={size} label={short ? "Done" : doneLabel} title={short ? doneLabel : undefined} className={short ? "shrink-0" : "max-w-full"} />
      ) : (
        <HealthPill health={bundle.health} reason={bundle.healthReason} size={size} className="shrink-0" />
      )}
    </>
  );
}

function FrameTab({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative inline-flex h-9 items-center gap-2 rounded-[12px] px-3 text-sm whitespace-nowrap transition-[color,background-color,box-shadow] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          active ? "bg-(--chip-bg) font-medium text-heading shadow-[0_0_0_1px_var(--chip-edge),var(--raised-shadow)]" : "text-muted-foreground hover:bg-well hover:text-heading",
        )}
      >
        {children}
      </Link>
    </li>
  );
}

function FrameSkeleton({ overview }: { overview: boolean }) {
  return (
    <div className={cn("min-w-0 space-y-2", !overview && "sm:hidden")} aria-busy="true" aria-label="Loading the project">
      <div className="flex items-center gap-2">
        <Skeleton className={cn("w-96 max-w-[70%]", overview ? "h-11" : "h-6")} />
        <Skeleton className="h-7 w-14 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
      </div>
      {overview ? <Skeleton className="h-5 w-[28rem] max-w-full" /> : null}
    </div>
  );
}
