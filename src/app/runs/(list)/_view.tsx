"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { PageHeader } from "@/components/common";
import { RunsTable, type RunFilters } from "@/components/runs/runs-table";
import type { RunStatusGroup } from "@/components/runs/run-bits";

const GROUPS: readonly RunStatusGroup[] = ["active", "needs_input", "done", "failed"];

/** /runs: every weft run, with filters kept in the URL (?status=&workflow=&project=&q=). */
export function RunsView() {
  const params = useSearchParams();
  const pathname = usePathname();

  const filters = useMemo<RunFilters>(() => {
    const status = params.get("status");
    return {
      status: status && (GROUPS as readonly string[]).includes(status) ? (status as RunStatusGroup) : undefined,
      workflow: params.get("workflow") || undefined,
      project: params.get("project") || undefined,
      q: params.get("q") || undefined,
    };
  }, [params]);

  const onFiltersChange = useCallback(
    (f: RunFilters) => {
      const sp = new URLSearchParams();
      if (f.status) sp.set("status", f.status);
      if (f.workflow) sp.set("workflow", f.workflow);
      if (f.project) sp.set("project", f.project);
      if (f.q) sp.set("q", f.q);
      const qs = sp.toString();
      // history.replaceState syncs useSearchParams without a server round trip (Next docs,
      // "Native History API"), so typing in a filter never waits on the network.
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Runs"
        description={
          <>
            Every weft run the projects started, newest first. <span className="font-mono whitespace-nowrap text-foreground">po-brd</span> and{" "}
            <span className="font-mono whitespace-nowrap text-foreground">architect-aad</span> (marked real) are the po-workspace workflows; the Stage 3 and 4 workflows (
            <span className="font-mono whitespace-nowrap text-foreground">dev-plan</span>, <span className="font-mono whitespace-nowrap text-foreground">dev-task</span>,{" "}
            <span className="font-mono whitespace-nowrap text-foreground">qa-verify</span>) are mocks shaped like them.
          </>
        }
      />
      <RunsTable filters={filters} onFiltersChange={onFiltersChange} />
    </div>
  );
}
