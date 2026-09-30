"use client";

/**
 * Confirmed dependencies (R1..Rn, cited by the document) as a stacked list that reads well from
 * 390px up: id, ref, kind, relation chip, title and why.
 */
import { BookOpen, Ticket } from "lucide-react";
import { dependencyWhyText, relationText } from "@/components/projects/sources";
import type { Dependency } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";

export interface DependencyItem {
  id?: string;
  ref: string;
  kind: string;
  relation: string;
  title: string;
  why?: string;
  note?: string;
}

export function KindBadge({ kind }: { kind: string }) {
  const confluence = kind === "confluence";
  const Icon = confluence ? BookOpen : Ticket;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <Icon aria-hidden className="size-3.5" />
      {confluence ? "Confluence" : "Jira"}
    </span>
  );
}

export function RelationChip({ relation, className }: { relation: string; className?: string }) {
  return <span className={cn("inline-flex h-5 items-center rounded-full bg-muted px-2 text-[11px] whitespace-nowrap text-muted-foreground", className)}>{relationText(relation)}</span>;
}

export function DependenciesList({ items, className, emptyText = "No dependencies recorded.", workflow }: { items: Array<DependencyItem | Dependency>; className?: string; emptyText?: string; workflow?: string }) {
  if (items.length === 0) return <p className={cn("rounded-xl border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground", className)}>{emptyText}</p>;
  return (
    <ul className={cn("divide-y divide-border overflow-hidden rounded-xl border border-border", className)}>
      {items.map((d) => (
        <li key={`${d.id ?? ""}-${d.ref}`} className="space-y-1 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {d.id ? <span className="inline-flex h-5 items-center rounded-md bg-primary-soft px-1.5 font-mono text-[11px] font-medium text-primary">{d.id}</span> : null}
            <span className="font-mono text-xs text-foreground">{d.ref}</span>
            <KindBadge kind={d.kind} />
            <RelationChip relation={d.relation} />
            {"note" in d && d.note ? <span className="text-[11px] text-muted-foreground">{d.note}</span> : null}
          </div>
          <p className="text-[13px] leading-snug font-medium">{d.title}</p>
          {d.why ? <p className="text-xs leading-snug text-muted-foreground">{dependencyWhyText(d.relation, d.why, workflow)}</p> : null}
        </li>
      ))}
    </ul>
  );
}
