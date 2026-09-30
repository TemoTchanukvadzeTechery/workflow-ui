"use client";

/**
 * All projects as a table or as cards (the choice is remembered per browser), with search and
 * filters. ?stage=<id> (from the Home pipeline) filters to projects currently in that stage.
 */
import { FolderKanban, Plus, SearchX } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { EmptyState, ErrorState, PageHeader, SectionCard } from "@/components/common";
import { ProjectCard, ProjectCardSkeleton, ProjectRowsSkeleton, ProjectsTable } from "@/components/project-list";
import { applyFilters, EMPTY_FILTERS, isFiltered, ProjectFilters, type ProjectFilterState, type ProjectsViewMode } from "@/components/project-list/ProjectFilters";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/lib/api/queries";
import { isStageId, stageDef } from "@/lib/delivery/types";
import { plural } from "@/lib/format";

// Per-browser layout preference. Storage can be unavailable (private mode), so reads and writes
// are guarded and an in-memory value keeps the toggle working for this tab.
const VIEW_KEY = "workflow-ui:projects-view";
const viewListeners = new Set<() => void>();
let viewMemory: ProjectsViewMode | null = null;

function readView(): ProjectsViewMode {
  if (viewMemory) return viewMemory;
  try {
    return window.localStorage.getItem(VIEW_KEY) === "cards" ? "cards" : "table";
  } catch {
    return "table";
  }
}

function writeView(v: ProjectsViewMode): void {
  viewMemory = v;
  try {
    window.localStorage.setItem(VIEW_KEY, v);
  } catch {
    // keep the in-memory choice
  }
  viewListeners.forEach((l) => l());
}

function subscribeView(l: () => void): () => void {
  viewListeners.add(l);
  return () => viewListeners.delete(l);
}

export function ProjectsView() {
  const q = useProjects();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view = useSyncExternalStore(subscribeView, readView, () => "table" as const);

  const stageParam = params.get("stage");
  const stage = stageParam && isStageId(stageParam) ? stageParam : "all";
  const [rest, setRest] = useState<Omit<ProjectFilterState, "stage">>({ q: "", health: "all", attention: false, includeDone: false });
  const filters: ProjectFilterState = { ...rest, stage };

  const onFilters = (next: ProjectFilterState) => {
    const { stage: nextStage, ...r } = next;
    setRest(r);
    if (nextStage !== stage) {
      const sp = new URLSearchParams(params.toString());
      if (nextStage === "all") sp.delete("stage");
      else sp.set("stage", nextStage);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  };

  const all = q.data ?? [];
  const rows = applyFilters(all, filters);
  const hiddenDone = !filters.includeDone ? applyFilters(all, { ...filters, includeDone: true }).filter((p) => p.done).length : 0;

  return (
    <div className="flex flex-col gap-6 lg:gap-7">
      <PageHeader
        title="Projects"
        description="Each project moves through Requirements, Architecture, Implementation, QA Certification and PO Review. Agents draft; people accept."
        actions={
          <Button asChild size="lg">
            <Link href="/projects/new">
              New project
              <Plus aria-hidden />
            </Link>
          </Button>
        }
      >
        <ProjectFilters value={filters} onChange={onFilters} view={view} onViewChange={writeView} />
      </PageHeader>

      {q.isPending ? (
        view === "cards" ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading projects">
            {Array.from({ length: 6 }, (_, i) => (
              <ProjectCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="card-surface overflow-hidden rounded-[28px] pt-4" aria-busy="true" aria-label="Loading projects">
            <ProjectRowsSkeleton rows={7} />
          </div>
        )
      ) : q.error ? (
        <SectionCard>
          <ErrorState title="Could not load projects" error={q.error} onRetry={() => void q.refetch()} />
        </SectionCard>
      ) : all.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            body="Start from a Product Owner request with Jira and Confluence sources, or import an existing BRD."
            action={
              <Button asChild>
                <Link href="/projects/new">
                  <Plus aria-hidden />
                  New project
                </Link>
              </Button>
            }
          />
        </SectionCard>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="px-1 text-sm text-muted-foreground" aria-live="polite">
            {rows.length === all.length ? plural(all.length, "project") : `${rows.length} of ${plural(all.length, "project")}`}
            {stage !== "all" ? ` in ${stageDef(stage).title}` : ""}
            {hiddenDone > 0 ? (
              <>
                {" · "}
                <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => onFilters({ ...filters, includeDone: true })}>
                  show {plural(hiddenDone, "done project")}
                </button>
              </>
            ) : null}
          </p>
          {rows.length === 0 ? (
            <SectionCard>
              <EmptyState
                icon={SearchX}
                title="No projects match these filters"
                body={stage !== "all" ? `No active project is in ${stageDef(stage).title} right now.` : "Try another search or clear the filters."}
                action={
                  isFiltered(filters) ? (
                    <Button variant="secondary" onClick={() => onFilters({ ...EMPTY_FILTERS, includeDone: filters.includeDone })}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            </SectionCard>
          ) : view === "cards" ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          ) : (
            <>
              {/* Phones get cards: seven table columns do not fit in 390px. */}
              <div className="grid gap-4 sm:hidden">
                {rows.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
              <SectionCard flush bodyClassName="pt-2" className="hidden sm:flex">
                <ProjectsTable rows={rows} showNextStep />
              </SectionCard>
            </>
          )}
        </div>
      )}
    </div>
  );
}
