/** TanStack Query keys. live.ts invalidates by these prefixes when /api/events says something changed. */
import type { MemoryTimelineKind } from "@/lib/memory/types";
import type { RunStatus } from "@/lib/weft/types";

export const qk = {
  dashboard: ["dashboard"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  doc: (projectId: string, docId: string, v?: number) => ["doc", projectId, docId, v ?? "latest"] as const,
  inbox: ["inbox"] as const,
  activity: (projectId?: string, limit?: number) => ["activity", projectId ?? "all", limit ?? 50] as const,
  settings: ["settings"] as const,
  workspaceFiles: (prefix: string) => ["workspace-files", prefix] as const,

  memoryStatus: ["memory", "status"] as const,
  memoryOverview: ["memory", "overview"] as const,
  memoryNote: (id: string) => ["memory", "note", id] as const,
  memorySearch: (q: string, types?: string, deep?: boolean, limit?: number) => ["memory", "search", q, types ?? "", deep ?? false, limit ?? 0] as const,
  memoryGraph: ["memory", "graph"] as const,
  memoryStale: ["memory", "stale"] as const,
  memoryHealth: ["memory", "health"] as const,
  memoryTimeline: (kind: MemoryTimelineKind) => ["memory", "timeline", kind] as const,
  memoryNoteHistory: (id: string, limit?: number) => ["memory", "history", id, limit ?? 0] as const,
  /** Outside the "memory" prefix on purpose: a commit never changes, so live events never refetch it. */
  memoryCommit: (sha: string, path?: string | null) => ["memory-commit", sha, path ?? ""] as const,

  meta: ["weft", "meta"] as const,
  workflows: ["weft", "workflows"] as const,
  workflow: (name: string) => ["weft", "workflow", name] as const,
  runs: (f: { status?: RunStatus; workflow?: string; limit?: number } = {}) => ["weft", "runs", f.status ?? "", f.workflow ?? "", f.limit ?? 0] as const,
  run: (runId: string) => ["weft", "run", runId] as const,
  runTree: (runId: string) => ["weft", "run", runId, "tree"] as const,
  runPending: (runId: string) => ["weft", "run", runId, "pending"] as const,
  runArtifacts: (runId: string) => ["weft", "run", runId, "artifacts"] as const,
  runPatch: (runId: string, key?: string) => ["weft", "run", runId, "patch", key ?? ""] as const,
  runReport: (runId: string) => ["weft", "run", runId, "report"] as const,
  pending: ["weft", "pending"] as const,
  /** Blobs are immutable: never invalidated. */
  blob: (ref: string) => ["blob", ref] as const,
};
