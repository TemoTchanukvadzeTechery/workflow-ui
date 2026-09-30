"use client";

/**
 * A stored BRD/AAD with its version menu, numbered like everywhere else (v1 review:1, v2 Edited
 * by Dana in review, v3 review:2), and the viewer's Diff mode against the previous version.
 * Citation chips jump to the Sources table inside the document.
 */
import { ArrowUpRight } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { CircleIconButton, ErrorState, StatusPill } from "@/components/common";
import { DocViewer, versionLabels } from "@/components/docs";
import { useDoc } from "@/lib/api/queries";
import type { DocumentArtifact } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { jumpToSource } from "./doc-jump";

export interface DocVersionViewerProps {
  projectId: string;
  doc: DocumentArtifact;
  title?: ReactNode;
  /** Extra header content before the version menu. */
  headerExtra?: ReactNode;
  /** Scroll the body, e.g. "max-h-[70vh]". */
  bodyClassName?: string;
  toc?: boolean;
  className?: string;
  /** Receives the element that wraps the rendered document (for section jumps). */
  containerRef?: (el: HTMLDivElement | null) => void;
  /** Heading id prefix when the page shows two documents. */
  onCitationClick?: (source: string, part: string, root: HTMLElement | null) => void;
  showOpenLink?: boolean;
}

export function DocVersionViewer({ projectId, doc, title, headerExtra, bodyClassName, toc = true, className, containerRef, onCitationClick, showOpenLink = true }: DocVersionViewerProps) {
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const latest = doc.versions.at(-1)?.n;
  // A new version arriving live moves the viewer to it unless the reader picked an older one.
  const version = picked !== undefined && doc.versions.some((v) => v.n === picked) ? picked : latest;
  const q = useDoc(projectId, doc.id, version === latest ? undefined : version);
  const wrap = useRef<HTMLDivElement | null>(null);
  const label = versionLabels(doc.versions).find((l) => l.n === version);

  if (q.isError && !q.data) {
    return (
      <div className={cn("card-surface rounded-2xl", className)}>
        <ErrorState title={`Could not load ${doc.path}`} error={q.error} onRetry={() => void q.refetch()} size="sm" />
      </div>
    );
  }

  return (
    <div
      ref={(el) => {
        wrap.current = el;
        containerRef?.(el);
      }}
      className={cn("min-w-0", className)}
    >
      <DocViewer
        title={title ?? doc.title}
        path={doc.path}
        text={q.data?.text ?? ""}
        loading={q.isPending}
        versions={doc.versions}
        currentVersion={version}
        onVersionChange={(n) => setPicked(n === latest ? undefined : n)}
        toc={toc}
        bodyClassName={bodyClassName}
        onCitationClick={(source, part) => (onCitationClick ? onCitationClick(source, part, wrap.current) : jumpToSource(wrap.current, source))}
        headerExtra={
          <>
            {headerExtra}
            {version !== latest && label ? <StatusPill tone="attention" icon={null} label={`Viewing ${label.label}, not the latest`} size="sm" /> : null}
            {showOpenLink ? (
              <CircleIconButton
                size="md"
                href={`/projects/${encodeURIComponent(projectId)}/docs/${encodeURIComponent(doc.id)}${version && version !== latest ? `?v=${version}` : ""}`}
                icon={ArrowUpRight}
                label={`Open ${doc.path} full page`}
                title="Full page"
              />
            ) : null}
          </>
        }
      />
    </div>
  );
}
