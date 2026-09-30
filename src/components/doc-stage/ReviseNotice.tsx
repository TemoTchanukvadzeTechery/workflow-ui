"use client";

/**
 * A reopened (or stale) Stage 1 / Stage 2 whose BRD / AAD was already accepted: say why it was
 * reopened and offer the two ways to revise the document, "Start another run" (the reopen comment
 * goes with it as a note) and "Import new version". Once the document has a newer version the
 * notice turns neutral and only asks for the gate again.
 */
import { History, Import, RotateCcw } from "lucide-react";
import { actorText } from "@/components/common";
import { Notice, TimeAgo } from "@/components/hitl";
import { ImportDocDialog } from "@/components/projects";
import { Button } from "@/components/ui/button";
import type { DocumentArtifact } from "@/lib/delivery/types";
import { DOC_LABEL, DOC_WORKFLOW, revisedSince, type DocKind, type RevisionCause } from "./run-utils";

export interface ReviseNoticeProps {
  projectId: string;
  kind: DocKind;
  cause: RevisionCause;
  doc?: DocumentArtifact;
  onStartAnother?: () => void;
  onImported?: () => void;
  /** Another banner on the page already offers "Start another run". */
  hideStart?: boolean;
  className?: string;
}

export function ReviseNotice({ projectId, kind, cause, doc, onStartAnother, onImported, hideStart, className }: ReviseNoticeProps) {
  const label = DOC_LABEL[kind];
  const workflow = DOC_WORKFLOW[kind];
  const revised = revisedSince(doc, cause);
  const latest = doc?.versions.at(-1)?.n;
  const stageTitle = kind === "brd" ? "Requirements" : "Architecture";
  return (
    <Notice tone={revised ? "neutral" : "attention"} icon={History} role="status" className={className}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-64 space-y-0.5">
          {cause.kind === "reopened" ? (
            <p>
              <span className="font-medium">
                {stageTitle} was reopened{cause.by ? ` by ${actorText(cause.by)}` : ""}:
              </span>{" "}
              <span className="break-words">{cause.comment}</span> <TimeAgo at={cause.at} prefix="(" suffix=")" className="text-xs opacity-80" />
            </p>
          ) : (
            <p className="font-medium">The {label} may need to follow the change upstream.</p>
          )}
          <p className="text-xs opacity-90">
            {revised
              ? `The ${label} has changed since (now v${latest}). Check it, then approve the stage again.`
              : `Revise the ${label}: start another ${workflow} run (the ${cause.kind === "reopened" ? "reopen comment" : "reason"} and the current ${label} go with it as notes), or import a new version. Then approve the stage again.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!hideStart && onStartAnother ? (
            <Button type="button" size="sm" variant={revised ? "outline" : "default"} className="rounded-full" onClick={onStartAnother}>
              <RotateCcw aria-hidden />
              Start another run
            </Button>
          ) : null}
          <ImportDocDialog
            projectId={projectId}
            stage={kind === "brd" ? "requirements" : "architecture"}
            onImported={onImported ? () => onImported() : undefined}
            trigger={
              <Button type="button" size="sm" variant="outline" className="rounded-full bg-card">
                <Import aria-hidden />
                Import new version
              </Button>
            }
          />
        </div>
      </div>
    </Notice>
  );
}
