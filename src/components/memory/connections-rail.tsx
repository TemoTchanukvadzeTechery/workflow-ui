/**
 * The note-detail right rail (plan A4): the note's neighbors in two sections (outgoing, incoming),
 * grouped by edge property — depends_on, consumers, related, owner, projects, systems, documents —
 * with body wikilinks (property null) as "Mentions" / "Mentioned in". Each entry is a type icon
 * plus a title Link. `graphSlot` is the clean slot the MP2 ego graph renders into, above the
 * groups. Hook-free and server-compatible.
 */
import { Minus, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState, SectionCard } from "@/components/common";
import type { MemoryNeighborInfo } from "@/lib/memory/types";
import { cn } from "@/lib/utils";
import { MEMORY_TYPE_META } from "./status-meta";

const PROPERTY_ORDER = ["depends_on", "consumers", "related", "owner", "projects", "systems", "documents"] as const;

const PROPERTY_LABEL: Record<string, string> = {
  depends_on: "Depends on",
  consumers: "Consumers",
  related: "Related",
  owner: "Owner",
  projects: "Projects",
  systems: "Systems",
  documents: "Documents",
};

/** null property = a body wikilink: this note mentions / is mentioned by the neighbor. */
function groupLabel(property: string | null, direction: "out" | "in"): string {
  if (property === null) return direction === "out" ? "Mentions" : "Mentioned in";
  return PROPERTY_LABEL[property] ?? property.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

interface Group {
  key: string;
  label: string;
  entries: MemoryNeighborInfo[];
}

/** Stable grouping: known properties in PROPERTY_ORDER, then unknown ones, then body mentions. */
function groupNeighbors(neighbors: MemoryNeighborInfo[], direction: "out" | "in"): Group[] {
  const byKey = new Map<string, Group>();
  const seen = new Map<string, Set<string>>();
  for (const n of neighbors) {
    const key = n.property ?? "\u0000mentions";
    const ids = seen.get(key) ?? new Set<string>();
    if (ids.has(n.id)) continue;
    ids.add(n.id);
    seen.set(key, ids);
    const group = byKey.get(key) ?? { key, label: groupLabel(n.property, direction), entries: [] };
    group.entries.push(n);
    byKey.set(key, group);
  }
  const rank = (key: string) => {
    if (key === "\u0000mentions") return PROPERTY_ORDER.length + 1;
    const i = (PROPERTY_ORDER as readonly string[]).indexOf(key);
    return i === -1 ? PROPERTY_ORDER.length : i;
  };
  return [...byKey.values()].sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label));
}

function NeighborRow({ neighbor }: { neighbor: MemoryNeighborInfo }) {
  const Icon: LucideIcon = neighbor.type ? MEMORY_TYPE_META[neighbor.type].icon : Minus;
  return (
    <li>
      <Link
        href={`/memory/${neighbor.id}`}
        className="group -mx-2 flex items-center gap-2 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-well/70 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
        <span className="min-w-0 truncate text-sm text-foreground group-hover:text-heading">{neighbor.title ?? neighbor.id}</span>
      </Link>
    </li>
  );
}

function DirectionSection({ title, groups }: { title: string; groups: Group[] }) {
  if (groups.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h3 className="kicker">{title}</h3>
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1">
          <span className="text-[13px] leading-5 font-medium text-muted-foreground">{group.label}</span>
          <ul className="flex flex-col">
            {group.entries.map((n) => (
              <NeighborRow key={n.id} neighbor={n} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export interface ConnectionsRailProps {
  neighbors: { out: MemoryNeighborInfo[]; in: MemoryNeighborInfo[] };
  /** The MP2 ego graph's slot, rendered above the link groups. */
  graphSlot?: ReactNode;
  className?: string;
}

export function ConnectionsRail({ neighbors, graphSlot, className }: ConnectionsRailProps) {
  const out = groupNeighbors(neighbors.out, "out");
  const inbound = groupNeighbors(neighbors.in, "in");
  const empty = out.length === 0 && inbound.length === 0;
  return (
    <SectionCard density="dense" title="Connections" className={cn("min-w-0", className)} bodyClassName="flex flex-col gap-5">
      {graphSlot}
      {empty ? (
        <EmptyState size="sm" title="No connections" body="Frontmatter links and body mentions of other notes appear here." />
      ) : (
        <>
          <DirectionSection title="Links out" groups={out} />
          <DirectionSection title="Linked from" groups={inbound} />
        </>
      )}
    </SectionCard>
  );
}
