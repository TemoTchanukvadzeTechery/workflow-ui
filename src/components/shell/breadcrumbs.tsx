"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { stageHref } from "@/hooks/use-stage-params";
import { useMemoryNote, useProject } from "@/lib/api/queries";
import { isStageId, stageDef, type ProjectBundle } from "@/lib/delivery/types";
import { isMemoryNoteId } from "@/lib/memory/types";
import { cn } from "@/lib/utils";

interface Crumb {
  label: string;
  href?: string;
  mono?: boolean;
}

const DOC_KIND_LABEL: Record<string, string> = { brd: "BRD", aad: "AAD", memory: "Memory", plan: "Plan", "ready-for-test": "Ready for test" };

/**
 * The stage a task page belongs to: QA Certification once the task is in QA (Implementation
 * approved and a qa-verify run started on it), else Implementation. The same rule as the task
 * page's back link, so the breadcrumb, the project tabs and the back link agree.
 */
export function taskSection(bundle: ProjectBundle | undefined, taskId: string): "implementation" | "qa" {
  const task = bundle?.tasks.find((t) => t.id === taskId);
  return bundle && task && bundle.stages.implementation.status === "approved" && task.qa.runIds.length > 0 ? "qa" : "implementation";
}

/** Documents are usually titled after their project; then the crumb names the kind instead of repeating the project. */
function docCrumb(doc: { kind: string; title: string } | undefined, projectName: string | undefined): string | undefined {
  if (!doc) return undefined;
  const kind = DOC_KIND_LABEL[doc.kind] ?? doc.kind;
  if (!doc.title || (projectName && doc.title.toLowerCase().includes(projectName.toLowerCase()))) return kind;
  return doc.title;
}

/**
 * Crumbs derived from the pathname (SPEC 5.1 routes). Project and document names come from the
 * cached project bundle, so this adds no request beyond what the page already makes.
 */
export function Breadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname();
  const seg = pathname.split("/").filter(Boolean).map(safeDecode);
  const projectId = seg[0] === "projects" && seg[1] && seg[1] !== "new" ? seg[1] : undefined;
  const bundle = useProject(projectId);
  // Memory note ids are `<type>/<slug>`; the detail page fetches the same key, so this is cached.
  const memoryId = seg[0] === "memory" && seg[1] && seg[2] && isMemoryNoteId(`${seg[1]}/${seg[2]}`) ? `${seg[1]}/${seg[2]}` : undefined;
  const memoryNote = useMemoryNote(memoryId);
  const crumbs = buildCrumbs(seg, {
    projectName: bundle.data?.project.name,
    taskStage: seg[2] === "tasks" && seg[3] ? taskSection(bundle.data, seg[3]) : undefined,
    docTitle: seg[2] === "docs" && seg[3] ? docCrumb(bundle.data?.documents.find((d) => d.id === seg[3]), bundle.data?.project.name) : undefined,
    memoryTitle: memoryNote.data?.card.title,
  });

  return (
    <Breadcrumb className={cn("min-w-0", className)}>
      <BreadcrumbList className="flex-nowrap gap-1 text-[13px] text-muted-foreground sm:gap-1.5">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          // Narrow screens keep only the current page; the page header carries the context.
          const hideNarrow = !last && "hidden sm:inline-flex";
          return (
            <Fragment key={`${i}:${c.label}`}>
              <BreadcrumbItem className={cn("min-w-0", hideNarrow)}>
                {last || !c.href ? (
                  <BreadcrumbPage className={cn("truncate", c.mono && "font-mono text-xs", last ? "text-foreground" : "text-inherit")}>{c.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild className={cn("max-w-[14rem] truncate rounded-sm text-inherit outline-none hover:text-heading focus-visible:ring-3 focus-visible:ring-ring/50", c.mono && "font-mono text-xs")}>
                    <Link href={c.href}>{c.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!last && <BreadcrumbSeparator className={cn("text-muted-numeral", hideNarrow)}>/</BreadcrumbSeparator>}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/** Top-level pages have the nav item as their context; only nested pages get a breadcrumb row. */
const TOP_LEVEL = new Set(["/", "/inbox", "/projects", "/runs", "/memory", "/settings"]);

/** The small muted breadcrumb row under the top navigation, on nested pages only. */
export function BreadcrumbRow({ className }: { className?: string }) {
  const pathname = usePathname();
  if (TOP_LEVEL.has(pathname.replace(/\/+$/, "") || "/")) return null;
  return (
    <div className={cn("flex h-8 items-center", className)}>
      <Breadcrumbs />
    </div>
  );
}

function buildCrumbs(seg: string[], names: { projectName?: string; docTitle?: string; taskStage?: "implementation" | "qa"; memoryTitle?: string }): Crumb[] {
  const [a, b, c, d] = seg;
  if (!a) return [{ label: "Home" }];
  switch (a) {
    case "inbox":
      return [{ label: "Inbox" }];
    case "settings":
      return [{ label: "Settings" }];
    case "runs":
      return b ? [{ label: "Runs", href: "/runs" }, { label: b, mono: true }] : [{ label: "Runs" }];
    case "memory": {
      // Note ids are `<type>/<slug>`, so a note detail path has two segments after /memory.
      if (!b) return [{ label: "Memory" }];
      const id = c ? `${b}/${c}` : b;
      return [{ label: "Memory", href: "/memory" }, { label: names.memoryTitle ?? id, mono: !names.memoryTitle }];
    }
    case "projects": {
      const root: Crumb = { label: "Projects", href: "/projects" };
      if (!b) return [{ label: "Projects" }];
      if (b === "new") return [root, { label: "New project" }];
      const base = `/projects/${encodeURIComponent(b)}`;
      const project: Crumb = { label: names.projectName ?? b, href: base };
      if (!c) return [root, project];
      if (isStageId(c)) return [root, project, { label: stageDef(c).title }];
      if (c === "tasks") {
        const stage = names.taskStage ?? "implementation";
        const parent: Crumb = { label: stageDef(stage).title, href: stageHref(b, stage, { step: stage === "qa" ? "tasks" : "execution" }) };
        return d ? [root, project, parent, { label: d, mono: true }] : [root, project, parent];
      }
      if (c === "docs") return [root, project, { label: names.docTitle ?? d ?? "Document", mono: !names.docTitle }];
      return [root, project, { label: c }];
    }
    default:
      return [{ label: a }];
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
