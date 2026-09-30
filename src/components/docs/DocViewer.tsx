"use client";

/**
 * A BRD/AAD/plan document: TOC from h2/h3 on the left, rendered markdown, and a mode switch for
 * Preview / Edit (monospace textarea, when editable) / Diff (against the previous version, or
 * `compareText`). The version menu lists DocVersions by their stored number, the same one the
 * stage header, overview and activity use: "v1 review:1", "v2 Edited by Dana in review",
 * "v3 review:2".
 */
import { FileText, GitCompare, Pencil, Eye } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useBlobText } from "@/lib/api/queries";
import type { DocVersion } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { PillChoice } from "../hitl/controls";
import { Markdown } from "./Markdown";
import { TextDiff } from "./TextDiff";
import { extractHeadings } from "./toc";

export type DocViewerMode = "preview" | "edit" | "diff";

export interface DocViewerProps {
  title?: ReactNode;
  /** Repo path shown under the title, e.g. "brd/agreement-reporting.md". */
  path?: string;
  /** The text of the current version. */
  text: string;
  versions?: DocVersion[];
  /** DocVersion.n of `text`; defaults to the last version. */
  currentVersion?: number;
  onVersionChange?: (n: number) => void;
  editable?: boolean;
  /** Edited text (controlled). Falls back to `text` until the first change. */
  value?: string;
  onChange?: (text: string) => void;
  /** Text to diff against; defaults to the version before currentVersion (fetched by blob). */
  compareText?: string;
  compareLabel?: string;
  headerExtra?: ReactNode;
  onCitationClick?: (source: string, part: string) => void;
  loading?: boolean;
  /** Hide the TOC (narrow placements). */
  toc?: boolean;
  /** Scroll the body inside the viewer, e.g. "max-h-[70vh]". Omit to grow with the page. */
  bodyClassName?: string;
  className?: string;
  defaultMode?: DocViewerMode;
  /** Mode of the viewer, controlled. */
  mode?: DocViewerMode;
  onModeChange?: (mode: DocViewerMode) => void;
}

export interface VersionLabel {
  n: number;
  label: string;
  detail?: string;
}

/**
 * Labels for versions: always the stored DocVersion.n ("v3"), so every screen agrees; the detail
 * says where it came from ("review:2", "Edited by Dana in review", "Imported from Confluence …").
 */
export function versionLabels(versions: readonly DocVersion[]): VersionLabel[] {
  return [...versions]
    .sort((a, b) => a.n - b.n)
    .map((v) => {
      const detail = v.source === "human-edit" ? (v.reason ?? "Human edit") : v.source === "import" ? (v.reason ?? "Imported") : (v.roundKey ?? v.reason);
      return { n: v.n, label: `v${v.n}`, ...(detail ? { detail } : {}) };
    });
}

export function DocViewer({
  title,
  path,
  text,
  versions,
  currentVersion,
  onVersionChange,
  editable,
  value,
  onChange,
  compareText,
  compareLabel,
  headerExtra,
  onCitationClick,
  loading,
  toc = true,
  bodyClassName,
  className,
  defaultMode = "preview",
  mode: modeProp,
  onModeChange,
}: DocViewerProps) {
  const [modeState, setModeState] = useState<DocViewerMode>(defaultMode);
  const mode = modeProp ?? modeState;
  const setMode = (m: DocViewerMode) => {
    setModeState(m);
    onModeChange?.(m);
  };

  const sorted = useMemo(() => [...(versions ?? [])].sort((a, b) => a.n - b.n), [versions]);
  const labels = useMemo(() => versionLabels(sorted), [sorted]);
  const current = currentVersion ?? sorted[sorted.length - 1]?.n;
  const prev = useMemo(() => {
    const idx = sorted.findIndex((v) => v.n === current);
    return idx > 0 ? sorted[idx - 1] : undefined;
  }, [sorted, current]);
  const prevBlob = useBlobText(compareText === undefined && mode === "diff" ? prev?.blob : undefined);
  const baseline = compareText ?? prevBlob.data;
  const canDiff = compareText !== undefined || prev !== undefined;
  const baselineLabel = compareLabel ?? (prev ? (labels.find((l) => l.n === prev.n)?.label ?? `v${prev.n}`) : "previous");

  const shown = editable && value !== undefined ? value : text;
  const headings = useMemo(() => extractHeadings(shown).filter((h) => h.depth === 2 || h.depth === 3), [shown]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Highlight the TOC entry of the heading nearest the top of the viewport.
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || mode !== "preview" || headings.length === 0 || typeof IntersectionObserver === "undefined") return;
    const els = headings.map((h) => root.querySelector(`[id="${CSS.escape(h.id)}"]`)).filter((el): el is Element => !!el);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [headings, mode]);

  const jump = (id: string) => {
    if (mode !== "preview") setMode("preview");
    // Wait a frame when switching back to preview so the heading exists.
    requestAnimationFrame(() => {
      const el = bodyRef.current?.querySelector(`[id="${CSS.escape(id)}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(id);
    });
  };

  const modes = [
    { value: "preview" as const, label: "Preview", icon: Eye },
    ...(editable ? [{ value: "edit" as const, label: "Edit", icon: Pencil }] : []),
    ...(canDiff ? [{ value: "diff" as const, label: "Diff", icon: GitCompare }] : []),
  ];

  return (
    <section className={cn("@container min-w-0 rounded-2xl bg-card shadow-[0_1px_2px_rgba(0,0,0,.04)] dark:border dark:border-border", className)} aria-label={typeof title === "string" ? title : path}>
      {/* The title keeps at least ~16rem; when the header is narrower the controls wrap below it instead of squeezing it. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-[1_1_16rem] items-start gap-3">
          <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            {title ? <h3 className="line-clamp-2 text-[15px] font-medium break-words">{title}</h3> : null}
            {path ? <p className="font-mono text-[11px] break-words text-muted-foreground">{path}</p> : null}
          </div>
        </div>
        {headerExtra}
        {labels.length > 0 && onVersionChange ? (
          <Select value={current !== undefined ? String(current) : undefined} onValueChange={(v) => onVersionChange(Number(v))}>
            <SelectTrigger size="sm" className="rounded-full" aria-label="Version">
              <SelectValue placeholder="Version" />
            </SelectTrigger>
            <SelectContent align="end">
              {[...labels].reverse().map((l) => (
                <SelectItem key={l.n} value={String(l.n)}>
                  <span className="font-medium">{l.label}</span>
                  {l.detail ? <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{l.detail}</span> : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : labels.length > 0 ? (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{labels.find((l) => l.n === current)?.label ?? labels[labels.length - 1]?.label}</span>
        ) : null}
        {modes.length > 1 ? <PillChoice size="sm" value={mode} onChange={setMode} options={modes} ariaLabel="View mode" /> : null}
      </header>

      <div className={cn("flex min-w-0", toc && headings.length > 1 && mode === "preview" ? "gap-6" : "")}>
        {toc && headings.length > 1 && mode === "preview" ? (
          // Never taller than the body: capped at the body's own max height when the body scrolls inside the viewer, else at the viewport; sticky, with its own scroll.
          <nav aria-label="Contents" className={cn("sticky top-14 hidden w-48 shrink-0 self-start overflow-y-auto overscroll-contain py-4 pl-4 @2xl:block", bodyClassName ?? "max-h-[calc(100vh-8rem)]")}>
            <p className="mb-2 text-[10.5px] font-medium tracking-[0.12em] text-muted-foreground uppercase">Contents</p>
            <ul className="space-y-0.5 text-[13px]">
              {headings.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => jump(h.id)}
                    aria-current={activeId === h.id ? "location" : undefined}
                    className={cn(
                      "block w-full truncate rounded-md px-2 py-1 text-left transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      h.depth === 3 ? "pl-5 text-muted-foreground" : "text-foreground/80",
                      activeId === h.id && "bg-muted font-medium text-foreground",
                    )}
                    title={h.text}
                  >
                    {h.text}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <div ref={bodyRef} className={cn("relative min-w-0 flex-1 px-4 py-4 @xl:px-6", bodyClassName && `overflow-y-auto ${bodyClassName}`)}>
          {loading ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading document">
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
            </div>
          ) : mode === "edit" && editable ? (
            <textarea
              aria-label={`Edit ${path ?? "document"}`}
              spellCheck={false}
              value={shown}
              onChange={(e) => onChange?.(e.target.value)}
              className="block min-h-[60vh] w-full resize-y rounded-lg border border-input bg-transparent p-3 font-mono text-xs leading-5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          ) : mode === "diff" && canDiff ? (
            baseline === undefined ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Changes from <span className="font-medium text-foreground">{baselineLabel}</span> to{" "}
                  <span className="font-medium text-foreground">{editable && value !== undefined && value !== text ? "your edits" : (labels.find((l) => l.n === current)?.label ?? "this version")}</span>
                </p>
                <TextDiff before={baseline} after={shown} />
              </div>
            )
          ) : shown.trim() ? (
            <Markdown source={shown} onCitationClick={onCitationClick} />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">This document is empty.</p>
          )}
        </div>
      </div>
    </section>
  );
}
