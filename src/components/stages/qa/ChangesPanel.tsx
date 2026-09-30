"use client";

/**
 * QA sub-step "Changes & memory": what the project changed, grouped Code (per repo, with the
 * per-task diffs) / Memory (the Stage 1 and 2 memory:review updates: change list and diff) /
 * Docs. QA confirms each is consistent with the requirements (yes/no + comment). The Memory group
 * always shows: with no memory update it says why (imported documents, a discarded update, …).
 */
import { ChevronDown, CircleCheck, CircleX, Code2, FileText, GitBranch, Library } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { actorText, EmptyState, RelativeTime, SectionCard, StatusPill } from "@/components/common";
import { TextDiff } from "@/components/docs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useBlobText, useReviewChange, useRun } from "@/lib/api/queries";
import type { ChangeReview, DocumentArtifact, ProjectBundle } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { memoryStatusMeta } from "@/lib/weft/labels";
import { taskHref, taskKey } from "./shared";

function ReviewControls({ projectId, change, readOnly }: { projectId: string; change: ChangeReview; readOnly: boolean }) {
  const reviewed = change.consistent !== undefined;
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<boolean | null>(change.consistent ?? null);
  const [comment, setComment] = useState(change.comment ?? "");
  const review = useReviewChange(projectId);
  const commentId = useId();
  const groupId = useId();
  const needsComment = choice === false && !comment.trim();

  if (reviewed && !editing) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusPill tone={change.consistent ? "success" : "danger"} icon={change.consistent ? CircleCheck : CircleX} size="sm" label={change.consistent ? "Consistent with requirements" : "Not consistent"} />
        <span className="text-xs text-muted-foreground">
          {change.by ? actorText(change.by) : "someone"}
          {change.at ? (
            <>
              {" "}
              · <RelativeTime at={change.at} />
            </>
          ) : null}
          {change.comment ? <>: &ldquo;{change.comment}&rdquo;</> : null}
        </span>
        {!readOnly ? (
          <Button type="button" variant="ghost" size="xs" className="rounded-full" onClick={() => setEditing(true)}>
            Change
          </Button>
        ) : null}
      </div>
    );
  }
  if (readOnly) return <p className="text-xs text-muted-foreground">Not reviewed.</p>;

  const save = () => {
    if (choice === null || needsComment) return;
    review.mutate({ changeId: change.id, body: { consistent: choice, ...(comment.trim() ? { comment: comment.trim() } : {}) } }, { onSuccess: () => setEditing(false) });
  };

  return (
    <div className="space-y-2 rounded-lg bg-muted/60 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span id={groupId} className="text-xs font-medium">
          Consistent with requirements?
        </span>
        <div role="group" aria-label={`Is ${change.label} consistent with the requirements?`} className="inline-flex rounded-full bg-background p-0.5">
          {[
            { v: true, label: "Yes", icon: CircleCheck, on: "bg-status-success-bg text-status-success-fg" },
            { v: false, label: "No", icon: CircleX, on: "bg-status-danger-bg text-status-danger-fg" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              aria-pressed={choice === o.v}
              onClick={() => setChoice(o.v)}
              className={cn("inline-flex h-7 items-center gap-1 rounded-full px-3 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", choice === o.v ? o.on : "text-muted-foreground hover:text-foreground")}
            >
              <o.icon aria-hidden className="size-3.5" />
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor={commentId} className="text-xs text-muted-foreground">
          Comment {choice === false ? <span className="font-medium text-foreground">required: what does not match?</span> : "optional"}
        </label>
        <Textarea id={commentId} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} className="bg-background text-[13px]" aria-invalid={needsComment && comment.length > 0} />
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" className="h-7 rounded-full" onClick={save} disabled={choice === null || needsComment || review.isPending}>
          {review.isPending ? "Saving…" : "Save review"}
        </Button>
        {editing ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 rounded-full" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Disclosure({ label, children, defaultOpen = false }: { label: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={id} className="inline-flex items-center gap-1 rounded text-xs font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <ChevronDown aria-hidden className={cn("size-3.5 transition-transform duration-150", !open && "-rotate-90")} />
        {label}
      </button>
      {open ? (
        <div id={id} className="mt-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function CodeDetails({ projectId, bundle, change }: { projectId: string; bundle: ProjectBundle; change: ChangeReview }) {
  const tasks = bundle.tasks.filter((t) => t.repo === change.label && t.status !== "cancelled");
  if (tasks.length === 0) return null;
  return (
    <ul className="divide-y rounded-lg border">
      {tasks.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
          <Link href={taskHref(projectId, t.id)} className="font-mono text-xs font-medium text-primary hover:underline">
            {taskKey(t)}
          </Link>
          <span className="min-w-0 flex-1 truncate">{t.title}</span>
          {t.diffStats ? (
            <span className="font-mono text-[11px] tabular-nums">
              <span className="text-status-success-fg">+{t.diffStats.adds}</span> <span className="text-status-danger-fg">−{t.diffStats.dels}</span> <span className="text-muted-foreground">in {t.diffStats.files} files</span>
            </span>
          ) : null}
          <Link href={taskHref(projectId, t.id)} className="text-xs text-primary hover:underline" aria-label={`View the diff of ${taskKey(t)}`}>
            View diff
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** One memory:review update: its decision, the change list and the diff attachment. */
function MemoryUpdate({ runId, doc }: { runId: string; doc?: DocumentArtifact }) {
  const run = useRun(runId);
  const human = run.data?.humans.find((h) => h.key?.startsWith("memory:review"));
  const diffRef = human?.reviewAttachments?.find((a) => a.label === "diff")?.ref.$blob;
  const diff = useBlobText(diffRef);
  const decision = (human?.answer as { decision?: string } | undefined)?.decision;
  const label = doc ? (doc.kind === "brd" ? "BRD" : doc.kind === "aad" ? "AAD" : doc.kind.toUpperCase()) : run.data?.workflow;
  const changes = doc?.memory?.changes ?? [];

  return (
    <div className="space-y-2 rounded-lg border px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium">From the {label ?? "run"}</span>
        <Link href={`/runs/${runId}`} className="font-mono text-[11px] text-primary hover:underline">
          {run.data?.workflow ?? "run"} · {runId}
        </Link>
        {doc?.memory ? <StatusPill {...memoryStatusMeta(doc.memory.status)} size="sm" /> : null}
        {doc?.memory?.major ? <span className="text-[11px] text-muted-foreground">major update</span> : null}
        {decision ? <span className="text-[11px] text-muted-foreground">decision: <span className="font-mono">{decision}</span></span> : null}
      </div>
      {changes.length ? (
        <ul className="space-y-1">
          {changes.map((c, i) => {
            const m = /^([a-z-]+):\s*(.*)$/s.exec(c);
            return (
              <li key={i} className="flex items-start gap-2 text-xs leading-snug">
                <span className="mt-px inline-flex h-4.5 shrink-0 items-center rounded bg-muted px-1.5 font-mono text-[10.5px] text-muted-foreground">{m ? m[1] : "change"}</span>
                <span className="min-w-0">{m ? m[2] : c}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {run.isPending ? (
        <Skeleton className="h-4 w-32" />
      ) : diffRef ? (
        <Disclosure label="Show the memory diff">
          {diff.isPending ? <Skeleton className="h-24 w-full" /> : diff.data ? <TextDiff diffText={diff.data} maxHeightClass="max-h-80" /> : <p className="text-xs text-muted-foreground">Could not load the diff.</p>}
        </Disclosure>
      ) : (
        <p className="text-xs text-muted-foreground">No diff was attached to this memory update.</p>
      )}
    </div>
  );
}

function MemoryDetails({ bundle, change }: { bundle: ProjectBundle; change: ChangeReview }) {
  const docOf = (runId: string) => bundle.documents.find((d) => (d.kind === "brd" || d.kind === "aad") && d.versions.some((v) => v.runId === runId));
  return (
    <div className="space-y-2">
      {change.sourceRunIds.map((r) => (
        <MemoryUpdate key={r} runId={r} doc={docOf(r)} />
      ))}
    </div>
  );
}

function DocDetails({ projectId, bundle, change }: { projectId: string; bundle: ProjectBundle; change: ChangeReview }) {
  const doc = bundle.documents.find((d) => d.path === change.label);
  if (!doc) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <Link href={`/projects/${projectId}/docs/${doc.id}`} className="font-medium text-primary hover:underline">
        Open {doc.title}
      </Link>
      <span>
        {doc.versions.length} {doc.versions.length === 1 ? "version" : "versions"}
      </span>
      {doc.acceptedBy ? <span>accepted by {actorText(doc.acceptedBy)}</span> : null}
      {doc.dependencies.length ? <span>{doc.dependencies.length} dependencies</span> : null}
    </p>
  );
}

/**
 * Why there is no memory update to review: per BRD/AAD, imported (no run, so no memory step) or
 * the run's memory outcome.
 */
function noMemoryReason(bundle: ProjectBundle): string {
  const parts = (["brd", "aad"] as const).map((kind) => {
    const label = kind.toUpperCase();
    const imported = !!bundle.project.stages[kind === "brd" ? "requirements" : "architecture"].imported;
    const docs = bundle.documents.filter((d) => d.kind === kind);
    const doc = docs.find((d) => d.status === "accepted") ?? docs.at(-1);
    const status = doc?.memory?.status;
    const text = imported
      ? `the ${label} was imported`
      : !doc
        ? `there is no ${label}`
        : status === "discarded"
          ? `the ${label} memory update was discarded`
          : status === "skipped"
            ? `the ${label} run skipped its memory update`
            : status === "unchanged"
              ? `the ${label} run left memory unchanged`
              : `the ${label} run proposed no memory changes`;
    return { imported, text };
  });
  if (parts.every((p) => p.imported)) return "No memory updates: the BRD and AAD were imported, so no run proposed memory changes.";
  return `No memory updates: ${parts.map((p) => p.text).join(", and ")}.`;
}

const GROUPS: Array<{ kind: ChangeReview["kind"]; title: string; icon: typeof Code2; description: string }> = [
  { kind: "code", title: "Code", icon: Code2, description: "Per repository: files and lines changed by the approved tasks." },
  { kind: "memory", title: "Memory", icon: Library, description: "Shared memory updates proposed after the BRD and AAD were accepted." },
  { kind: "docs", title: "Documents", icon: FileText, description: "The accepted BRD and AAD the work was built against." },
];

export function ChangesPanel({ projectId, bundle, readOnly }: { projectId: string; bundle: ProjectBundle; readOnly: boolean }) {
  const all = bundle.changeReviews;
  const reviewed = all.filter((c) => c.consistent !== undefined).length;
  const inconsistent = all.filter((c) => c.consistent === false).length;
  const hasMemory = all.some((c) => c.kind === "memory");
  if (all.length === 0) {
    return <EmptyState icon={GitBranch} title="No changes to review yet" body="Code, memory and document changes appear here once tasks are done and documents are accepted." />;
  }
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">
          {reviewed}/{all.length}
        </span>{" "}
        changes reviewed. {hasMemory ? "Confirm that the code, the memory updates and the documents match the original requirements." : "Confirm that the code and the documents match the original requirements; there are no memory updates to review."}
        {inconsistent ? <span className="text-status-danger-fg"> {inconsistent} marked not consistent.</span> : null}
      </p>
      {GROUPS.map((g) => {
        const rows = all.filter((c) => c.kind === g.kind);
        // Memory always shows, so an empty group explains itself instead of silently missing.
        if (rows.length === 0 && g.kind !== "memory") return null;
        const Icon = g.icon;
        return (
          <SectionCard
            key={g.kind}
            density="dense"
            title={
              <span className="inline-flex items-center gap-2">
                <Icon aria-hidden className="size-4 text-muted-foreground" />
                {g.title}
              </span>
            }
            description={g.description}
            actions={rows.length ? <span className="text-xs text-muted-foreground tabular-nums">{rows.filter((r) => r.consistent !== undefined).length}/{rows.length} reviewed</span> : <span className="text-xs text-muted-foreground">Nothing to review</span>}
          >
            {rows.length === 0 ? (
              <p className="rounded-xl border border-dashed px-3 py-3 text-[13px] text-muted-foreground">{noMemoryReason(bundle)}</p>
            ) : (
              <ul className="space-y-3">
                {rows.map((c) => (
                  <li key={c.id} className={cn("space-y-2.5 rounded-xl border p-3", c.consistent === false && "border-status-danger-fg/30")}>
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <div className="min-w-0">
                        <p className="font-mono text-[13px] font-medium break-all">{c.label}</p>
                        <p className="text-xs text-muted-foreground">{c.summary}</p>
                      </div>
                      {c.kind === "code" && c.files !== undefined ? (
                        <span className="shrink-0 font-mono text-xs tabular-nums">
                          <span className="text-status-success-fg">+{c.adds ?? 0}</span> <span className="text-status-danger-fg">−{c.dels ?? 0}</span>{" "}
                          <span className="text-muted-foreground">
                            · {c.files} {c.files === 1 ? "file" : "files"}
                          </span>
                        </span>
                      ) : null}
                    </div>
                    {c.kind === "code" ? <CodeDetails projectId={projectId} bundle={bundle} change={c} /> : c.kind === "memory" ? <MemoryDetails bundle={bundle} change={c} /> : <DocDetails projectId={projectId} bundle={bundle} change={c} />}
                    <ReviewControls key={`${c.id}:${c.consistent ?? "-"}:${c.at ?? 0}`} projectId={projectId} change={c} readOnly={readOnly} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        );
      })}
    </div>
  );
}
