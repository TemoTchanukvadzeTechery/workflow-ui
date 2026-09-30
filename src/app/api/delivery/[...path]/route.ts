/**
 * /api/delivery/*: projects, stages, epics, tasks, QA, inbox, dashboard, settings (SPEC 3.2).
 * All logic lives in src/server/delivery/router.ts.
 */
import { handleDeliveryRequest } from "@/server/delivery/router";
import { getRuntime } from "@/server/runtime";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  return handleDeliveryRequest(getRuntime(), req, path);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
