"use client";

/**
 * The /memory tab in the URL (`?view=table|graph|health|timeline`), so a tab can be linked
 * (`/memory?view=health#check-owners`) and survives a reload. Writes go through
 * history.replaceState, which syncs useSearchParams without a server round trip (Next docs,
 * "Native History API"), and keep every other param: `?q=` of the table and the timeline's
 * `kind`, `commit` and `file`. useSearchParams needs a Suspense boundary (page.tsx has it).
 */
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export const MEMORY_VIEWS = ["table", "graph", "health", "timeline"] as const;
export type MemoryViewMode = (typeof MEMORY_VIEWS)[number];

const DEFAULT_VIEW: MemoryViewMode = "table";

/** The view a `?view=` value names; the table for anything else. */
export function parseMemoryView(value: string | null | undefined): MemoryViewMode {
  return (MEMORY_VIEWS as readonly string[]).includes(value ?? "") ? (value as MemoryViewMode) : DEFAULT_VIEW;
}

/** A link to a Memory tab, e.g. memoryViewHref("health", "check-owners") → `/memory?view=health#check-owners`. */
export function memoryViewHref(view: MemoryViewMode, hash?: string): string {
  const base = view === DEFAULT_VIEW ? "/memory" : `/memory?view=${view}`;
  const fragment = hash ? hash.replace(/^#/, "") : "";
  return fragment ? `${base}#${fragment}` : base;
}

/** The current tab and a setter that rewrites `?view=` in place (no navigation, no history entry). */
export function useMemoryView(): { view: MemoryViewMode; setView: (view: MemoryViewMode) => void } {
  const params = useSearchParams();
  const pathname = usePathname();
  const view = parseMemoryView(params.get("view"));

  const setView = useCallback(
    (next: MemoryViewMode) => {
      const sp = new URLSearchParams(window.location.search);
      if (next === DEFAULT_VIEW) sp.delete("view");
      else sp.set("view", next);
      const qs = sp.toString();
      // The hash belongs to the tab being left (#check-<id> on Health), so it is dropped.
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname],
  );

  return { view, setView };
}
