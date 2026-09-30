/** TanStack Query keys. live.ts invalidates by these prefixes when /api/events says something changed. */
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
