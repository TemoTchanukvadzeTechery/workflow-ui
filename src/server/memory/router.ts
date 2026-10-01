import "server-only";
/**
 * /api/memory/* (plan A1): a read-only view over the po-workspace memory vault. Mirrors the
 * delivery router's shape. Errors: vault/CLI missing → 503 with the checkVault payload; a
 * MemoryCliError → 502 carrying the CLI's message/code/details; unknown note → 404; a
 * MemoryRequestError → its own status (bad sha/cursor/path 400, commit outside history 404).
 * Health and history answer 200 with `git.ok: false` when git is unavailable; a MemoryGitError
 * that still escapes is never a 5xx for a missing git or repository (409).
 */
import { isMemoryNoteId, isMemoryTimelineKind, type MemoryTimelineKind } from "@/lib/memory/types";
import { isMemoryCliError } from "./cli";
import { checkVault } from "./config";
import { isMemoryRequestError, MemoryRequestError } from "./errors";
import { isMemoryGitError, type MemoryGitErrorKind } from "./git";
import { getMemoryHealth } from "./health";
import { commitDiff, noteHistory, vaultTimeline } from "./history";
import { getGraph, getMemoryStatus, getOverview, getStale, noteDetail, rebuildMemoryIndex, searchMemory } from "./service";

type Params = Record<string, string>;
interface Ctx {
  url: URL;
  params: Params;
}
type Handler = (ctx: Ctx) => Promise<Response> | Response;

const json = (data: unknown, status = 200) => Response.json(data, { status });

const TIMELINE_LIMIT_MAX = 50;
const HISTORY_LIMIT_MAX = 200;
const CURSOR_MAX_LENGTH = 200;

const GIT_ERROR_STATUS: Record<MemoryGitErrorKind, number> = { "no-git": 409, "not-a-repo": 409, "bad-revision": 404, timeout: 504, failed: 502 };

const isFlag = (value: string | null) => ["1", "true"].includes(value ?? "");

/** A positive integer `?limit=` capped at `max`; anything else means "the default". */
function limitParam(url: URL, max: number): number | undefined {
  const raw = Number(url.searchParams.get("limit") ?? "");
  return Number.isInteger(raw) && raw > 0 ? Math.min(raw, max) : undefined;
}

function timelineKind(url: URL): MemoryTimelineKind {
  const kind = url.searchParams.get("kind");
  if (kind === null || kind === "") return "all";
  if (!isMemoryTimelineKind(kind)) throw new MemoryRequestError(400, `kind must be all, signoff or edit, not "${kind}"`);
  return kind;
}

function cursorParam(url: URL): string | null {
  const before = url.searchParams.get("before");
  if (before === null || before === "") return null;
  if (before.length > CURSOR_MAX_LENGTH) throw new MemoryRequestError(400, "before is not a timeline cursor");
  return before;
}

const routes: Array<[method: string, pattern: string, handler: Handler]> = [
  ["GET", "status", () => json(getMemoryStatus())],
  ["GET", "overview", async () => json(await getOverview())],
  [
    "GET",
    "notes/:type/:slug",
    async ({ params }) => {
      const id = `${params.type}/${params.slug}`;
      if (!isMemoryNoteId(id)) return json({ error: `"${id}" is not a memory note id` }, 404);
      const detail = await noteDetail(id);
      return detail ? json(detail) : json({ error: `No memory note ${id}` }, 404);
    },
  ],
  [
    "GET",
    "search",
    async ({ url }) => {
      const q = url.searchParams.get("q") ?? "";
      const types = (url.searchParams.get("types") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
      const deep = ["1", "true"].includes(url.searchParams.get("deep") ?? "");
      const rawLimit = Number(url.searchParams.get("limit") ?? "");
      const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
      return json(await searchMemory(q, { types, deep, limit }));
    },
  ],
  ["GET", "graph", async () => json(await getGraph())],
  ["GET", "stale", async () => json({ stale: await getStale() })],
  ["POST", "index/build", async () => json(await rebuildMemoryIndex())],
  ["GET", "health", async ({ url }) => json(await getMemoryHealth({ refresh: isFlag(url.searchParams.get("refresh")) }))],
  [
    "GET",
    "timeline",
    async ({ url }) => json(await vaultTimeline({ limit: limitParam(url, TIMELINE_LIMIT_MAX), before: cursorParam(url), kind: timelineKind(url) })),
  ],
  [
    "GET",
    "notes/:type/:slug/history",
    async ({ url, params }) => {
      const id = `${params.type}/${params.slug}`;
      if (!isMemoryNoteId(id)) return json({ error: `"${id}" is not a memory note id` }, 404);
      return json(await noteHistory(id, { limit: limitParam(url, HISTORY_LIMIT_MAX) }));
    },
  ],
  [
    "GET",
    "commits/:sha",
    async ({ url, params }) => {
      const path = url.searchParams.get("path");
      return json(await commitDiff(params.sha, path === null || path === "" ? undefined : path));
    },
  ],
];

function match(pattern: string, path: string[]): Params | undefined {
  const parts = pattern.split("/");
  if (parts.length !== path.length) return undefined;
  const params: Params = {};
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(":")) params[parts[i].slice(1)] = path[i];
    else if (parts[i] !== path[i]) return undefined;
  }
  return params;
}

export async function handleMemoryRequest(req: Request, path: string[]): Promise<Response> {
  const method = req.method.toUpperCase();
  const url = new URL(req.url);
  const segments = path.map((p) => decodeURIComponent(p)).filter(Boolean);
  try {
    let pathMatched = false;
    for (const [m, pattern, handler] of routes) {
      const params = match(pattern, segments);
      if (!params) continue;
      pathMatched = true;
      if (m !== method) continue;
      if (pattern !== "status") {
        // status always answers, describing what is (not) there; everything else needs the vault.
        const check = checkVault();
        if (!check.ok) {
          const missing = check.vaultExists ? `memory CLI at ${check.cliPath}` : `vault at ${check.vaultDir}`;
          return json({ error: `Memory workspace not found: no ${missing}. Set MEMORY_WORKSPACE in .env.local.`, check }, 503);
        }
      }
      return await handler({ url, params });
    }
    const where = `/api/memory/${segments.join("/")}`;
    return json({ error: pathMatched ? `${method} is not supported on ${where}` : `No route for ${method} ${where}` }, pathMatched ? 405 : 404);
  } catch (err) {
    if (isMemoryRequestError(err)) return json({ error: err.message }, err.status);
    if (isMemoryGitError(err)) return json({ error: err.message, kind: err.kind }, GIT_ERROR_STATUS[err.kind] ?? 502);
    if (isMemoryCliError(err)) return json({ error: err.message, code: err.code, details: err.details }, 502);
    console.error(`[memory] ${method} /${segments.join("/")} failed:`, err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
