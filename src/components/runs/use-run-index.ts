"use client";

/**
 * Which project, stage and task each weft run belongs to (GET /api/delivery/run-index). Keyed
 * under ["weft", …] so live run events and mutations (which invalidate ["weft"]) refresh it.
 * Reports pending until hydration finishes, like the hooks in queries.ts.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { ApiError } from "@/lib/api/client";
import { useHydrated } from "@/lib/api/queries";
import type { RunIndex } from "./run-index-types";

export const runIndexKey = ["weft", "run-index"] as const;

async function fetchRunIndex(): Promise<RunIndex> {
  const res = await fetch("/api/delivery/run-index", { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as RunIndex;
}

export function useRunIndex(): UseQueryResult<RunIndex, Error> {
  const q = useQuery({ queryKey: runIndexKey, queryFn: fetchRunIndex, staleTime: 5_000 });
  const hydrated = useHydrated();
  if (hydrated) return q;
  return { ...q, data: undefined, error: null, status: "pending", isPending: true, isSuccess: false, isError: false } as unknown as UseQueryResult<RunIndex, Error>;
}

/**
 * Live run events do not touch the index, so a run started by the orchestrator (a dev-task
 * wave, a QA loop-back) can be missing from it. Refetch once for each set of unknown run ids.
 */
export function useRunIndexFor(runIds: readonly string[]): UseQueryResult<RunIndex, Error> {
  const q = useRunIndex();
  const { data, isFetching, refetch } = q;
  const missing = data ? runIds.filter((id) => !data[id]).sort().join(",") : "";
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!missing || isFetching || asked.current.has(missing)) return;
    asked.current.add(missing);
    void refetch();
  }, [missing, isFetching, refetch]);
  return q;
}
