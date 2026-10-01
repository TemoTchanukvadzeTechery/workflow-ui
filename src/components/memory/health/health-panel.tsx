"use client";

/**
 * The Health tab on /memory (plan §3): the "Vault health" summary card, then the four check
 * groups in a 2×2 grid of collapsible rows. A `#check-<id>` hash (the Home card's deep links)
 * opens that row and scrolls it into view once the checks load. States: pending → skeleton, with
 * the index-building caption while it builds; error → ErrorState with retry; building → the
 * summary says so while the query polls; partial → skipped checks say why.
 */
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { CardSkeleton, ErrorState, SectionCard } from "@/components/common";
import { useMemoryHealth } from "@/lib/api/queries";
import { HEALTH_CHECKS } from "@/lib/memory/health-rules";
import type { MemoryHealthCheckId } from "@/lib/memory/types";
import { checkAnchor } from "./check-meta";
import { CheckGroupCard } from "./check-group-card";
import { MemoryHealthSummary } from "./health-summary";

const HASH_RE = /^#check-([a-z-]+)$/;
const CHECK_IDS: ReadonlySet<string> = new Set(HEALTH_CHECKS.map((c) => c.id));

/** The check a `#check-<id>` hash names; null for any other hash. */
function hashCheck(hash: string): MemoryHealthCheckId | null {
  const id = HASH_RE.exec(hash)?.[1];
  return id && CHECK_IDS.has(id) ? (id as MemoryHealthCheckId) : null;
}

export interface MemoryHealthPanelProps {
  /** The index is building: show the building state instead of an error. */
  building: boolean;
}

export function MemoryHealthPanel({ building }: MemoryHealthPanelProps) {
  const health = useMemoryHealth();
  // Explicit toggles win; otherwise the row the hash names is open.
  const [toggled, setToggled] = useState<Partial<Record<MemoryHealthCheckId, boolean>>>({});

  // The #check-<id> hash: tracked in state so the open row follows in-page hash changes too.
  const [anchor, setAnchor] = useState<MemoryHealthCheckId | null>(null);
  useEffect(() => {
    const read = () => setAnchor(hashCheck(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const loaded = health.data !== undefined;
  useEffect(() => {
    if (!anchor || !loaded) return;
    const row = document.getElementById(checkAnchor(anchor));
    if (!row) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    row.querySelector("button")?.focus({ preventScroll: true });
  }, [anchor, loaded]);

  if (health.isPending) return <HealthSkeleton building={building} />;
  if (health.error || !health.data) {
    return (
      <SectionCard>
        <ErrorState title="Could not check the memory vault" error={health.error ?? undefined} onRetry={() => void health.refetch()} />
      </SectionCard>
    );
  }

  const data = health.data;
  const isOpen = (id: MemoryHealthCheckId) => toggled[id] ?? anchor === id;
  const setOpen = (id: MemoryHealthCheckId, open: boolean) => setToggled((t) => ({ ...t, [id]: open }));
  return (
    <div className="flex flex-col gap-4">
      <MemoryHealthSummary health={data} />
      <div className="grid gap-4 lg:grid-cols-2">
        {data.groups.map((group) => (
          <CheckGroupCard key={group.id} group={group} checks={data.checks.filter((c) => c.group === group.id)} isOpen={isOpen} onOpenChange={setOpen} />
        ))}
      </div>
    </div>
  );
}

function HealthSkeleton({ building }: { building: boolean }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Checking the memory vault">
      {building && (
        <p role="status" className="flex items-center gap-2.5 px-1 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />
          Building the memory search index — the checks run once it is ready.
        </p>
      )}
      <CardSkeleton rows={4} />
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <CardSkeleton key={i} rows={4} />
        ))}
      </div>
    </div>
  );
}
