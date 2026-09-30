"use client";

/**
 * Activity feed (Home and project overview): who did what, in which project, and when. Items with
 * an href link to the page where it happened (a stage, a task, a request).
 */
import { Bot, Cog, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { actorText, EmptyState, InitialsAvatar, RelativeTime } from "@/components/common";
import { Button } from "@/components/ui/button";
import type { Activity, Actor } from "@/lib/delivery/types";
import { stageDef } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";

function ActorAvatar({ actor }: { actor: Actor }) {
  if (actor.kind === "human") return <InitialsAvatar name={actor.name} size="lg" />;
  const Icon = actor.kind === "agent" ? Bot : actor.kind === "policy" ? ShieldCheck : Cog;
  return (
    <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-well text-muted-foreground">
      <Icon className="size-4" strokeWidth={1.75} />
    </span>
  );
}

export interface ActivityFeedProps {
  items: Activity[];
  /** Projects by id; when given, each row shows its project's key (full name on hover). */
  projects?: Record<string, { name: string; key: string }>;
  /** Rows shown before "Show more". */
  initial?: number;
  emptyText?: string;
  className?: string;
}

export function ActivityFeed({ items, projects, initial = 8, emptyText = "No activity yet.", className }: ActivityFeedProps) {
  const [shown, setShown] = useState(initial);
  const sorted = [...items].sort((a, b) => b.at - a.at);
  if (sorted.length === 0) return <EmptyState size="sm" title={emptyText} className={className} />;
  const visible = sorted.slice(0, shown);

  return (
    <div className={cn("flex flex-col", className)}>
      <ol className="relative -mx-2 flex flex-col">
        {visible.map((a, i) => {
          const project = projects?.[a.projectId];
          const body = (
            <>
              <span className="relative flex flex-col items-center self-stretch">
                <ActorAvatar actor={a.actor} />
                {i < visible.length - 1 ? <span aria-hidden className="my-1 w-px flex-1 bg-rule" /> : null}
              </span>
              <span className="min-w-0 flex-1 pt-0.5 pb-4">
                <span className="block text-sm leading-5 text-heading">{a.text}</span>
                <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs leading-4 text-muted-foreground">
                  <span className={cn(a.actor.kind !== "human" && "font-mono")}>{actorText(a.actor)}</span>
                  <span aria-hidden>·</span>
                  {project ? (
                    <>
                      <span className="font-mono" title={project.name}>
                        {project.key}
                      </span>
                      <span aria-hidden>·</span>
                    </>
                  ) : (
                    <>
                      <span>{stageDef(a.stage).title}</span>
                      <span aria-hidden>·</span>
                    </>
                  )}
                  <RelativeTime at={a.at} />
                </span>
              </span>
            </>
          );
          return (
            <li key={a.id}>
              {a.href ? (
                <Link href={a.href} className="flex gap-3.5 rounded-[16px] px-2 pt-2 transition-colors duration-150 hover:bg-foreground/[0.035] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none dark:hover:bg-foreground/[0.05]">
                  {body}
                </Link>
              ) : (
                <div className="flex gap-3.5 px-2 pt-2">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
      {sorted.length > shown ? (
        <Button variant="secondary" size="sm" className="mt-1 self-start" onClick={() => setShown((n) => n + 12)}>
          Show {Math.min(12, sorted.length - shown)} more
        </Button>
      ) : null}
    </div>
  );
}
