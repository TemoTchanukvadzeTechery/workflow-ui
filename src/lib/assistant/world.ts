/**
 * What the assistant knows about the app right now: projects, the inbox, runs, workflows,
 * settings. Read through the same TanStack Query keys the pages use, so a lookup the page has
 * already made costs nothing and live updates (SSE) keep both fresh.
 */
import type { QueryClient } from "@tanstack/react-query";
import { delivery, memory, weft } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import type { InboxItem, ProjectBundle, ProjectSummary, Settings } from "@/lib/delivery/types";
import type { MemorySearchPayload } from "@/lib/memory/types";
import type { PendingResponse, RunRow, WorkflowRow } from "@/lib/weft/types";

/** Lookups younger than this are reused without a refetch. */
const FRESH_MS = 3_000;

export interface World {
  projects(): Promise<ProjectSummary[]>;
  project(id: string): Promise<ProjectBundle>;
  inbox(): Promise<InboxItem[]>;
  pending(): Promise<PendingResponse>;
  runs(): Promise<RunRow[]>;
  workflows(): Promise<WorkflowRow[]>;
  settings(): Promise<Settings>;
  memorySearch(q: string, limit?: number): Promise<MemorySearchPayload>;
  /** A project's display name, or the id when it is unknown. */
  projectName(id: string): Promise<string>;
}

export function createWorld(qc: QueryClient): World {
  const get = <T>(queryKey: readonly unknown[], queryFn: () => Promise<T>) => qc.fetchQuery({ queryKey, queryFn, staleTime: FRESH_MS });
  const world: World = {
    projects: () => get(qk.projects, delivery.projects),
    project: (id) => get(qk.project(id), () => delivery.project(id)),
    inbox: () => get(qk.inbox, delivery.inbox),
    pending: () => get(qk.pending, weft.pending),
    runs: () => get(qk.runs({ limit: 200 }), () => weft.runs({ limit: 200 })),
    workflows: () => get(qk.workflows, weft.workflows),
    settings: () => get(qk.settings, delivery.settings),
    memorySearch: (q, limit = 8) => get(qk.memorySearch(q, undefined, undefined, limit), () => memory.search(q, { limit })),
    projectName: async (id) => {
      try {
        return (await world.projects()).find((p) => p.id === id)?.name ?? id;
      } catch {
        return id;
      }
    },
  };
  return world;
}
