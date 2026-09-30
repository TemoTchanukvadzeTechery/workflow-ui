"use client";

/**
 * Projects as a table (Home and /projects): name + key, the mini 5-stage bar, current stage with
 * its status, waiting count, health, spend and last update. The whole row opens the project;
 * the name is the keyboard/link target.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CountBadge, HealthPill, Money, RelativeTime, SegmentBar, stageSegments, StatusPill } from "@/components/common";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ProjectSummary } from "@/lib/delivery/types";
import { stageDef } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { projectStatusMeta } from "@/lib/weft/labels";

export interface ProjectsTableProps {
  rows: ProjectSummary[];
  /** Show the next-step line under each name (the /projects page). */
  showNextStep?: boolean;
  className?: string;
}

export function ProjectsTable({ rows, showNextStep, className }: ProjectsTableProps) {
  const router = useRouter();
  return (
    <Table className={cn("text-[13px]", className)}>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-5">Project</TableHead>
          <TableHead className="hidden w-40 sm:table-cell">Stages</TableHead>
          <TableHead>Current stage</TableHead>
          <TableHead className="text-right">Waiting</TableHead>
          <TableHead className="hidden md:table-cell">Health</TableHead>
          <TableHead className="hidden text-right lg:table-cell">Spend</TableHead>
          <TableHead className="hidden pr-5 text-right md:table-cell">Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => {
          const href = `/projects/${p.id}`;
          const status = projectStatusMeta(p);
          return (
            <TableRow
              key={p.id}
              className="h-12 cursor-pointer"
              onClick={(e) => {
                // Let the name link, copy buttons and modified clicks behave natively.
                if ((e.target as HTMLElement).closest("a,button") || e.metaKey || e.ctrlKey || e.shiftKey) return;
                router.push(href);
              }}
            >
              <TableCell className="max-w-[18rem] py-2.5 pl-5 sm:max-w-[22rem]">
                <div className="flex min-w-0 items-baseline gap-2">
                  <Link href={href} className="min-w-0 truncate font-medium text-foreground underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none">
                    {p.name}
                  </Link>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{p.key}</span>
                </div>
                {showNextStep && p.nextStep ? <div className="mt-0.5 truncate text-xs text-muted-foreground">{p.nextStep}</div> : null}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <SegmentBar size="sm" segments={stageSegments(p.stageStatuses)} />
              </TableCell>
              <TableCell>
                <div className="flex min-w-0 items-center gap-2">
                  {!p.done ? <span className="hidden truncate text-muted-foreground xl:inline">{stageDef(p.currentStage).title}</span> : null}
                  <StatusPill {...status} size="sm" label={p.done ? "Done" : <><span className="xl:hidden">{stageDef(p.currentStage).title} · </span>{status.label}</>} />
                </div>
              </TableCell>
              <TableCell className="text-right">
                {p.waitingCount > 0 ? <CountBadge n={p.waitingCount} tone="attention" label={`${p.waitingCount} waiting on people`} /> : <span className="text-muted-foreground tabular-nums">0</span>}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {/* Done projects have no health to watch; the status column says Done. */}
                {p.done ? <span className="text-muted-foreground">-</span> : <HealthPill health={p.health} reason={p.healthReason} variant="plain" />}
              </TableCell>
              <TableCell className="hidden text-right lg:table-cell">
                <Money usd={p.spendUsd} />
              </TableCell>
              <TableCell className="hidden pr-5 text-right text-muted-foreground md:table-cell">
                <RelativeTime at={p.updatedAt} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
