"use client";

/**
 * The "Ready for test" hand-off the developer wrote at the Implementation gate (process doc
 * dev-test-handoff): where QA starts. It shows the note's TL;DR and environment, the tasks to
 * check first (named in the developer's notes, escalated, or approved with failing checks), the
 * other notes, and the full note behind a disclosure, with a link to the stored document.
 */
import { ChevronDown, ClipboardCheck, ExternalLink, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { actorText, RelativeTime, SectionCard } from "@/components/common";
import { Markdown } from "@/components/docs";
import { latestChecks } from "@/components/tasks";
import type { DeliveryTask, DocumentArtifact, ProjectBundle } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { activeTasks, taskHref, taskKey } from "./shared";

/** The latest Ready for test document of the project, if the Implementation gate stored one. */
export function readyForTestDoc(bundle: ProjectBundle): DocumentArtifact | undefined {
  return bundle.documents.filter((d) => d.kind === "ready-for-test").at(-1);
}

export function docHref(projectId: string, docId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/docs/${encodeURIComponent(docId)}`;
}

/** "## Heading" sections of the note: lower-cased heading → its non-blank lines. */
function noteSections(markdown: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of markdown.split("\n")) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      current = [];
      out.set(h[1].toLowerCase(), current);
    } else if (current && line.trim()) current.push(line.trim());
  }
  return out;
}

const bullet = (line: string) => line.replace(/^[-*]\s+/, "");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The line names the task by its Jira key or id as a whole token ("T-1" does not match "T-10"). */
const mentions = (line: string, t: DeliveryTask) => [taskKey(t), t.id].some((k) => new RegExp(`(^|[^\\w-])${escapeRe(k)}(?![\\w-])`).test(line));

interface CheckFirst {
  task: DeliveryTask;
  reasons: string[];
}

/**
 * Tasks QA should check first: the ones the developer's notes name (their note lines), else the
 * escalated ones and the ones approved with a failing check. Note lines naming no task are
 * returned as `other`.
 */
function checkFirst(tasks: DeliveryTask[], notes: string[]): { items: CheckFirst[]; other: string[] } {
  const items: CheckFirst[] = [];
  for (const t of tasks) {
    const named = notes.filter((n) => mentions(n, t));
    const reasons = named.length
      ? named
      : [
          ...(t.escalated ? ["Approved after the rework limit (escalated)."] : []),
          ...(latestChecks(t.checks).some((c) => c.status === "fail") ? ["Approved with a failing check."] : []),
        ];
    if (reasons.length) items.push({ task: t, reasons });
  }
  const other = notes.filter((n) => !tasks.some((t) => mentions(n, t)));
  return { items, other };
}

export function ReadyForTestCard({ projectId, bundle }: { projectId: string; bundle: ProjectBundle }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const doc = readyForTestDoc(bundle);
  const impl = bundle.project.stages.implementation;
  const note = impl.readyForTestNote?.trim() ?? "";
  if (!doc && !note) return null;

  const handoff = [...impl.decisions].reverse().find((d) => d.decision === "approved");
  const sections = noteSections(note);
  const tldr = (sections.get("tl;dr") ?? []).join(" ");
  const env = (sections.get("env") ?? []).map(bullet).join(" · ");
  const notes = (sections.get("notes") ?? []).map(bullet).filter((n) => !/^none\.?$/i.test(n));
  const tasks = activeTasks(bundle);
  const { items, other } = checkFirst(tasks, notes);

  return (
    <SectionCard
      density="dense"
      kicker="Hand-off from Implementation"
      title={
        <span className="inline-flex items-center gap-2">
          <ClipboardCheck aria-hidden className="size-4 text-muted-foreground" />
          Ready for test
        </span>
      }
      description={
        <span>
          {handoff ? (
            <>
              Written by {actorText(handoff.by)} at the Implementation gate <RelativeTime at={handoff.at} />.{" "}
            </>
          ) : null}
          QA tests against this note.
        </span>
      }
      actions={
        doc ? (
          <Link href={docHref(projectId, doc.id)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            Open the note
            <ExternalLink aria-hidden className="size-3" />
          </Link>
        ) : null
      }
    >
      <div className="space-y-3">
        {tldr || env ? (
          <div className="space-y-1 text-[13px]">
            {tldr ? <p className="leading-snug">{tldr}</p> : null}
            {env ? (
              <p className="text-xs text-muted-foreground">
                Environment: <span className="font-mono text-[11px] text-foreground">{env}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <h3 className="kicker">Check first</h3>
          {items.length ? (
            <ul className="space-y-1.5">
              {items.map(({ task, reasons }) => (
                <li key={task.id} className="flex items-start gap-2 rounded-lg bg-status-attention-bg px-3 py-2 text-[13px]">
                  <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-status-attention-fg" />
                  <div className="min-w-0 space-y-0.5">
                    <p className="min-w-0">
                      <Link href={taskHref(projectId, task.id)} className="font-mono text-xs font-medium text-primary hover:underline">
                        {taskKey(task)}
                      </Link>{" "}
                      <span className="break-words">{task.title}</span>
                    </p>
                    {reasons.map((r, i) => (
                      <p key={i} className="text-xs text-foreground/80">
                        {r}
                      </p>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Nothing flagged: no task was escalated or approved with a failing check, and the notes name none.</p>
          )}
        </div>

        {other.length ? (
          <div className="space-y-1">
            <h3 className="kicker">Developer notes</h3>
            <ul className="list-disc space-y-0.5 pl-5 text-[13px]">
              {other.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {note ? (
          <div>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls={bodyId}
              className="inline-flex items-center gap-1 rounded text-xs font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <ChevronDown aria-hidden className={cn("size-3.5 transition-transform duration-150", !open && "-rotate-90")} />
              {open ? "Hide the full note" : "Show the full note"}
            </button>
            {open ? (
              <div id={bodyId} className="mt-2 max-h-[28rem] overflow-y-auto rounded-xl border px-4 py-3">
                <Markdown source={note} size="sm" idPrefix="rft-" />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
