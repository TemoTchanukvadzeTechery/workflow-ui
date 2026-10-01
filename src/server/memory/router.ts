import "server-only";
/**
 * /api/memory/* (plan A1): a read-only view over the po-workspace memory vault. Mirrors the
 * delivery router's shape. Errors: vault/CLI missing → 503 with the checkVault payload; a
 * MemoryCliError → 502 carrying the CLI's message/code/details; unknown note → 404.
 */
import { isMemoryNoteId } from "@/lib/memory/types";
import { isMemoryCliError } from "./cli";
import { checkVault } from "./config";
import { getGraph, getMemoryStatus, getOverview, getStale, noteDetail, rebuildMemoryIndex, searchMemory } from "./service";

type Params = Record<string, string>;
interface Ctx {
  url: URL;
  params: Params;
}
type Handler = (ctx: Ctx) => Promise<Response> | Response;

const json = (data: unknown, status = 200) => Response.json(data, { status });

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
    if (isMemoryCliError(err)) return json({ error: err.message, code: err.code, details: err.details }, 502);
    console.error(`[memory] ${method} /${segments.join("/")} failed:`, err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
