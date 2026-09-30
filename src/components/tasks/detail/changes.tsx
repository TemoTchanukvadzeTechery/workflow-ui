"use client";

/**
 * The Changes tab. It opens on "All changes": the net diff of the task branch, the one the
 * developer reviews (the latest task:review subject, when no patch came after it), else every
 * patch of the run combined. Each patch the run captured (implement:<id>, fix:<n> after a
 * failing check, rework:<n>:<id>) can be opened on its own. Every view has its file list
 * (+adds / -dels, added / modified / deleted) and the unified diff, rendered by TextDiff.
 */
import { FileMinus2, FilePen, FilePlus2, FileQuestion, GitMerge } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState, StatusPill } from "@/components/common";
import { TextDiff, parseDiffText } from "@/components/docs";
import { Skeleton } from "@/components/ui/skeleton";
import { useBlobText, useRun, useRunPatch } from "@/lib/api/queries";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FileStat, PatchResponse, RunDetail } from "@/lib/weft/types";
import { Segmented } from "../task-bits";

const FILE_ICON: Record<FileStat["status"], typeof FilePen> = { added: FilePlus2, modified: FilePen, deleted: FileMinus2, binary: FileQuestion };

const ALL = "__all";

/** "Implementation", "Fix 1", "Rework 2". */
export function patchLabel(key: string): string {
  const rework = /^rework:(\d+):/.exec(key);
  if (rework) return `Rework ${rework[1]}`;
  const fix = /^fix:(\d+)$/.exec(key);
  if (fix) return `Fix ${fix[1]}`;
  if (key.startsWith("implement:")) return "Implementation";
  return key;
}

type Patch = PatchResponse["patches"][number];

/** Per-file stats of a unified diff. */
function statsOf(diff: string): FileStat[] {
  return parseDiffText(diff)
    .filter((f) => f.path)
    .map((f) => {
      const meta = f.rows.filter((r) => r.type === "meta").map((r) => r.text);
      const status: FileStat["status"] = meta.some((m) => m.startsWith("new file mode"))
        ? "added"
        : meta.some((m) => m.startsWith("deleted file mode"))
          ? "deleted"
          : meta.some((m) => m.startsWith("Binary files"))
            ? "binary"
            : "modified";
      return { path: f.path!, adds: f.adds, dels: f.dels, status };
    });
}

/** Summed per-file stats of several patches (a file changed twice counts both times). */
function combinedStats(patches: readonly Patch[]): FileStat[] {
  const by = new Map<string, FileStat>();
  for (const p of patches) {
    for (const f of p.stats) {
      const prev = by.get(f.path);
      by.set(f.path, prev ? { ...prev, adds: prev.adds + f.adds, dels: prev.dels + f.dels, status: prev.status === "added" ? "added" : f.status } : { ...f });
    }
  }
  return [...by.values()];
}

/**
 * The latest task:review whose subject still is the branch's net diff (no patch was captured
 * after it was asked), with its diff blob ref.
 */
function netReview(run: RunDetail | undefined, patches: readonly Patch[]): { key: string; ref: string } | null {
  if (!run) return null;
  const review = [...run.humans].reverse().find((h) => h.key?.startsWith("task:review:") && h.reviewSubject?.kind === "artifact");
  if (!review?.reviewSubject || !review.key) return null;
  const stepSeq = (key: string) => run.steps.find((s) => s.key === key)?.seq ?? Infinity;
  const lastPatch = patches.at(-1);
  if (lastPatch && stepSeq(lastPatch.key) > review.seq) return null;
  return { key: review.key, ref: review.reviewSubject.ref.$blob };
}

export function ChangesPanel({ runId, attemptLabel }: { runId: string; attemptLabel?: string }) {
  const q = useRunPatch(runId);
  const runQ = useRun(runId);
  const patches = useMemo(() => q.data?.patches ?? [], [q.data]);
  const [picked, setPicked] = useState<string>(ALL);
  const net = netReview(runQ.data, patches);
  const netText = useBlobText(net?.ref);

  if (q.isPending) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-8 w-64 rounded-full" />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }
  if (q.error) return <ErrorState size="sm" title="Could not load the changes" error={q.error} onRetry={() => void q.refetch()} />;
  if (patches.length === 0) return <EmptyState size="sm" icon={FilePen} title="No changes captured yet" body="The agent's patch appears here once the Implement step finishes." />;

  // One patch is its own "all changes"; with several, All changes comes first.
  const current: Patch | null = patches.length === 1 ? patches[0]! : (patches.find((p) => p.key === picked) ?? null);
  const netDiff = net && netText.data !== undefined ? netText.data : undefined;
  const view = current
    ? { stats: current.stats, diff: current.diff, outOfScope: current.outOfScope, note: current.key, empty: current.available ? "No diff text for this patch." : "The patch blob is not available." }
    : netDiff !== undefined
      ? { stats: statsOf(netDiff), diff: netDiff, outOfScope: [...new Set(patches.flatMap((p) => p.outOfScope))], note: `Net change on the branch, as reviewed in ${net!.key}`, empty: "The branch has no changes." }
      : {
          stats: combinedStats(patches),
          diff: patches.map((p) => p.diff ?? "").filter(Boolean).join("\n") || undefined,
          outOfScope: [...new Set(patches.flatMap((p) => p.outOfScope))],
          note: `${plural(patches.length, "patch", "patches")} in order; the net diff comes with the next review`,
          empty: "No diff text for these patches.",
        };
  const loadingNet = !current && !!net && netText.isPending;
  const adds = view.stats.reduce((n, f) => n + f.adds, 0);
  const dels = view.stats.reduce((n, f) => n + f.dels, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {patches.length > 1 ? (
          <Segmented
            label="Changes to show"
            value={current ? current.key : ALL}
            onChange={setPicked}
            options={[{ value: ALL, label: "All changes" }, ...patches.map((p) => ({ value: p.key, label: patchLabel(p.key) }))]}
          />
        ) : null}
        <span className={cn("text-xs text-muted-foreground", current && "font-mono")}>{view.note}</span>
        {attemptLabel ? <span className="text-xs text-muted-foreground">· {attemptLabel}</span> : null}
        <span className="flex-1" />
        {current?.merged ? <StatusPill tone="success" icon={GitMerge} size="sm" label="Merged into the branch" /> : current?.discarded ? <StatusPill tone="neutral" size="sm" label="Discarded" icon={null} /> : null}
      </div>

      {loadingNet ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-3 py-1.5 text-xs">
              <span className="font-medium">{plural(view.stats.length, "file")} changed</span>
              <span className="font-mono tabular-nums">
                <span className="text-status-success-fg">+{adds}</span> <span className="text-status-danger-fg">−{dels}</span>
              </span>
            </div>
            <ul>
              {view.stats.map((f) => {
                const Icon = FILE_ICON[f.status];
                const outOfScope = view.outOfScope.includes(f.path);
                return (
                  <li key={f.path} className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-1.5 text-[13px] last:border-b-0">
                    <Icon aria-hidden className={cn("size-3.5 shrink-0", f.status === "added" ? "text-status-success-fg" : f.status === "deleted" ? "text-status-danger-fg" : "text-muted-foreground")} />
                    <span className="sr-only">{f.status}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f.path}>
                      {f.path}
                    </span>
                    {outOfScope ? <StatusPill tone="attention" size="sm" label="Out of scope" icon={null} /> : null}
                    <span className="shrink-0 font-mono text-[11px] tabular-nums">
                      <span className="text-status-success-fg">+{f.adds}</span> <span className="text-status-danger-fg">−{f.dels}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {view.diff ? <TextDiff diffText={view.diff} maxHeightClass="max-h-[70vh]" /> : <p className="rounded-xl bg-muted/50 px-3 py-6 text-center text-[13px] text-muted-foreground">{view.empty}</p>}
        </>
      )}
    </div>
  );
}
