import "server-only";
/**
 * /api/delivery/* (SPEC 3.2). Parses the request, calls the store, and maps DeliveryError to
 * `{ error }` with 400/404/409. The acting person comes from the `x-actor` header.
 */
import { isStageId, type Actor, type Settings, type StageId } from "@/lib/delivery/types";
import { resetRuntime, type Runtime } from "../runtime";
import { bad, errorMessage, human, isDeliveryError, isRecord, notFound } from "./util";

type Params = Record<string, string>;
interface Ctx {
  rt: Runtime;
  req: Request;
  url: URL;
  params: Params;
  actor: Actor;
  body(): Promise<Record<string, unknown>>;
}
type Handler = (ctx: Ctx) => Promise<Response> | Response;

const json = (data: unknown, status = 200) => Response.json(data, { status });

const DOC_STAGES = ["requirements", "architecture"] as const;
type DocStage = (typeof DOC_STAGES)[number];

function docStage(stage: string): DocStage {
  if (!(DOC_STAGES as readonly string[]).includes(stage)) throw bad("Only requirements and architecture have documents to import or epics to accept.");
  return stage as DocStage;
}

function stageParam(stage: string): StageId {
  if (!isStageId(stage)) throw notFound(`Unknown stage ${stage}`);
  return stage;
}

const routes: Array<[method: string, pattern: string, handler: Handler]> = [
  ["GET", "dashboard", async ({ rt }) => json(await rt.store.dashboard())],
  ["GET", "projects", async ({ rt }) => json(await rt.store.summaries())],
  [
    "POST",
    "projects",
    async ({ rt, body, actor }) => {
      const pd = await rt.store.createProject((await body()) as never, actor);
      return json(await rt.store.bundle(pd.project.id), 201);
    },
  ],
  ["GET", "projects/:id", async ({ rt, params }) => json(await rt.store.bundle(params.id))],
  [
    "DELETE",
    "projects/:id",
    async ({ rt, params, actor }) => {
      await rt.store.deleteProject(params.id, actor);
      return json({ ok: true });
    },
  ],
  [
    "PATCH",
    "projects/:id/intake",
    async ({ rt, params, body, actor }) => {
      rt.store.updateIntake(params.id, (await body()) as never, actor);
      return json(await rt.store.bundle(params.id));
    },
  ],
  ["POST", "projects/:id/notes", async ({ rt, params, body, actor }) => json(rt.store.addNote(params.id, (await body()) as never, actor))],
  [
    "DELETE",
    "projects/:id/notes/:noteId",
    ({ rt, params, actor }) => {
      rt.store.deleteNote(params.id, params.noteId, actor);
      return json({ ok: true });
    },
  ],
  [
    "POST",
    "projects/:id/stages/:stage/start",
    async ({ rt, params, body, actor }) => {
      const stage = stageParam(params.stage);
      if (stage === "requirements") return json(await rt.store.startRequirements(params.id, actor));
      if (stage === "architecture") return json(await rt.store.startArchitecture(params.id, (await body()) as never, actor));
      if (stage === "implementation") return json(await rt.store.startPlan(params.id, (await body()) as never, actor));
      throw bad(`${stage} has no run to start here; use ${stage === "qa" ? "qa/start" : "the stage decision"} instead.`);
    },
  ],
  [
    "POST",
    "projects/:id/stages/:stage/import",
    async ({ rt, params, body, actor }) => {
      const stage = stageParam(params.stage);
      await rt.store.importDoc(params.id, docStage(stage), (await body()) as never, actor);
      return json(await rt.store.bundle(params.id));
    },
  ],
  [
    "POST",
    "projects/:id/stages/:stage/decision",
    async ({ rt, params, body, actor }) => {
      await rt.store.decideStage(params.id, stageParam(params.stage), (await body()) as never, actor);
      return json(await rt.store.bundle(params.id));
    },
  ],
  [
    "POST",
    "projects/:id/stages/:stage/reopen",
    async ({ rt, params, body, actor }) => {
      rt.store.reopenStage(params.id, stageParam(params.stage), (await body()) as never, actor);
      return json(await rt.store.bundle(params.id));
    },
  ],
  ["POST", "projects/:id/epics", async ({ rt, params, body, actor }) => json(rt.store.upsertEpic(params.id, (await body()) as never, actor))],
  [
    "POST",
    "projects/:id/epics/accept",
    async ({ rt, params, body, actor }) => {
      const b = await body();
      if (typeof b.stage !== "string") throw bad('Provide stage: "requirements" or "architecture".');
      rt.store.acceptEpics(params.id, docStage(b.stage), actor);
      return json(await rt.store.bundle(params.id));
    },
  ],
  [
    "POST",
    "projects/:id/epics/sync",
    async ({ rt, params, actor }) => {
      rt.store.syncEpics(params.id, actor);
      return json(await rt.store.bundle(params.id));
    },
  ],
  [
    "DELETE",
    "projects/:id/epics/:epicId",
    ({ rt, params, actor }) => {
      rt.store.deleteEpic(params.id, params.epicId, actor);
      return json({ ok: true });
    },
  ],
  ["POST", "projects/:id/tasks/start", async ({ rt, params, body, actor }) => json(await rt.store.startTasks(params.id, (await body()) as never, actor))],
  ["PATCH", "projects/:id/tasks/:taskId", async ({ rt, params, body, actor }) => json(await rt.store.patchTask(params.id, params.taskId, (await body()) as never, actor))],
  ["POST", "projects/:id/tasks/:taskId/retry", async ({ rt, params, actor }) => json(await rt.store.retryTask(params.id, params.taskId, actor))],
  ["POST", "projects/:id/qa/start", async ({ rt, params, body, actor }) => json(await rt.store.startQa(params.id, (await body()) as never, actor))],
  ["POST", "projects/:id/trace/:brRef/waive", async ({ rt, params, body, actor }) => json(await rt.store.waiveTrace(params.id, params.brRef, (await body()) as never, actor))],
  ["POST", "projects/:id/changes/:changeId/review", async ({ rt, params, body, actor }) => json(rt.store.reviewChange(params.id, params.changeId, (await body()) as never, actor))],
  [
    "GET",
    "projects/:id/docs/:docId",
    async ({ rt, params, url }) => {
      const raw = url.searchParams.get("v");
      const v = raw === null || raw === "" || raw === "latest" ? undefined : Number(raw);
      if (v !== undefined && (!Number.isInteger(v) || v < 1)) throw bad("v must be a version number.");
      return json(await rt.store.doc(params.id, params.docId, v));
    },
  ],
  ["GET", "inbox", async ({ rt }) => json(await rt.store.inbox())],
  [
    "GET",
    "activity",
    ({ rt, url }) => {
      const projectId = url.searchParams.get("projectId") || undefined;
      const limit = Number(url.searchParams.get("limit") ?? "") || undefined;
      if (projectId && projectId !== "all") rt.store.get(projectId);
      return json(rt.store.activity({ projectId: projectId === "all" ? undefined : projectId, limit: limit && Math.min(limit, 500) }));
    },
  ],
  ["GET", "workspace/files", ({ rt, url }) => json(rt.store.workspaceFiles(url.searchParams.get("prefix") ?? ""))],
  ["GET", "settings", ({ rt }) => json(rt.settings())],
  ["PATCH", "settings", async ({ rt, body }) => json(rt.updateSettings((await body()) as Partial<Settings>))],
  [
    "POST",
    "admin/reset",
    async () => {
      // Not rt.reset(): rt may be a runtime built by older code (HMR keeps it on globalThis).
      await resetRuntime();
      return json({ ok: true });
    },
  ],
  [
    "POST",
    "admin/fast-forward",
    async ({ rt, body }) => {
      const b = await body();
      if (b.runId !== undefined && b.runId !== null && typeof b.runId !== "string") throw bad("runId must be a run id.");
      try {
        rt.engine.fastForward(typeof b.runId === "string" && b.runId ? b.runId : undefined);
      } catch (err) {
        throw notFound(errorMessage(err));
      }
      return json({ ok: true });
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

function actorOf(req: Request): Actor {
  const raw = req.headers.get("x-actor");
  if (!raw) return human(undefined);
  try {
    return human(decodeURIComponent(raw));
  } catch {
    return human(raw);
  }
}

export async function handleDeliveryRequest(rt: Runtime, req: Request, path: string[]): Promise<Response> {
  const method = req.method.toUpperCase();
  const url = new URL(req.url);
  const segments = path.map((p) => decodeURIComponent(p)).filter(Boolean);
  let parsed: Record<string, unknown> | undefined;
  const body = async () => {
    if (parsed) return parsed;
    const text = await req.text();
    if (!text.trim()) return (parsed = {});
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw bad("Request body must be JSON.");
    }
    if (!isRecord(value)) throw bad("Request body must be a JSON object.");
    return (parsed = value);
  };
  try {
    let pathMatched = false;
    for (const [m, pattern, handler] of routes) {
      const params = match(pattern, segments);
      if (!params) continue;
      pathMatched = true;
      if (m !== method) continue;
      await rt.ready;
      return await handler({ rt, req, url, params, actor: actorOf(req), body });
    }
    const where = `/api/delivery/${segments.join("/")}`;
    return json({ error: pathMatched ? `${method} is not supported on ${where}` : `No route for ${method} ${where}` }, pathMatched ? 405 : 404);
  } catch (err) {
    if (isDeliveryError(err)) return json({ error: err.message }, err.status);
    console.error(`[delivery] ${method} /${segments.join("/")} failed:`, err);
    return json({ error: errorMessage(err) }, 500);
  }
}
