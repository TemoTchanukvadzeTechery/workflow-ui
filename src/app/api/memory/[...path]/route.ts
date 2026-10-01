/**
 * /api/memory/*: read-only memory vault viewer (status, overview, notes, search, graph, stale)
 * plus POST index/build. All logic lives in src/server/memory/router.ts.
 */
import { handleMemoryRequest } from "@/server/memory/router";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  return handleMemoryRequest(req, path);
}

export const GET = handle;
export const POST = handle;
