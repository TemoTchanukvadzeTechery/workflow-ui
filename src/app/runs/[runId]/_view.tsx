"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { RUN_TABS, RunInspector, type RunTab } from "@/components/runs/run-inspector";

/** /runs/[runId]?tab=&step= : the run inspector with its tab and selected step kept in the URL. */
export function RunDetailView({ runId }: { runId: string }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const rawTab = params.get("tab");
  const tab = rawTab && (RUN_TABS as readonly string[]).includes(rawTab) ? (rawTab as RunTab) : undefined;
  const rawStep = params.get("step");
  const seq = rawStep && /^\d+$/.test(rawStep) ? Number(rawStep) : undefined;

  const onNavigate = useCallback(
    (next: { tab?: RunTab; seq?: number }) => {
      const sp = new URLSearchParams();
      if (next.tab && next.tab !== "steps") sp.set("tab", next.tab);
      if (next.seq !== undefined) sp.set("step", String(next.seq));
      const qs = sp.toString();
      // history.replaceState syncs useSearchParams without a server round trip (Next docs,
      // "Native History API"), so typing in a filter never waits on the network.
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname],
  );

  return <RunInspector runId={runId} tab={tab} seq={seq} onNavigate={onNavigate} />;
}
