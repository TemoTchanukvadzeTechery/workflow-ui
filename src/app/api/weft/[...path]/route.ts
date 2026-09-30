/**
 * /api/weft/* : the weft daemon API. Served in-process by the mock engine, or proxied to a
 * real daemon when settings.dataSource is "weft" (same paths, same shapes, so the UI never
 * knows which one answered).
 */
import { handleWeftRequest } from "@/server/mock/daemon";
import { getRuntime } from "@/server/runtime";
import { proxyToDaemon } from "@/server/weft/proxy";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  try {
    const rt = getRuntime();
    await rt.ready;
    const settings = rt.settings();
    if (settings.dataSource === "weft") return await proxyToDaemon(req, path, settings.weftDaemon);
    return await handleWeftRequest(rt.engine, req, path);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return handle(req, ctx);
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(req, ctx);
}
