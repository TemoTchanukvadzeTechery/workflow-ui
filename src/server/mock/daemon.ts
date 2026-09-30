import "server-only";
/**
 * The weft daemon's /api surface over a WeftBackend (the mock engine), so /api/weft/* answers
 * exactly like http://127.0.0.1:4781/api/*: same paths, status codes (202 for a start, 404
 * when the message says "not found", else 400), `{ error }` bodies, text/markdown reports,
 * raw blob bytes and the journal SSE stream (weft daemon app.ts streamJournal).
 */
import type { JournalRecord, RunStatus } from "@/lib/weft/types";
import { WeftApiError, type MockEngineControls, type WeftBackend } from "./engine/api";

type Backend = WeftBackend & Partial<MockEngineControls>;

const HEARTBEAT_MS = 15_000;
const DEFAULT_ACTOR = "Demo user";

export const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
} as const;

/** weft's http.ts rule (a WeftApiError keeps the status it was raised with). */
function fail(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  const status = err instanceof WeftApiError ? err.status : /\bnot found\b/i.test(message) ? 404 : 400;
  return Response.json({ error: message }, { status });
}

async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw new Error("expected a JSON object body");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("expected a JSON object body");
  return parsed as Record<string, unknown>;
}

/** The "Acting as" name; the client URI-encodes it so any name survives the header (same rule as the delivery router). */
function actorName(req: Request): string {
  const raw = req.headers.get("x-actor");
  if (!raw) return DEFAULT_ACTOR;
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // not URI-encoded: use it as is
  }
  return name.trim() || DEFAULT_ACTOR;
}

function intParam(value: string | null): number | undefined {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : undefined;
}

export async function handleWeftRequest(engine: Backend, req: Request, path: string[]): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams;
  const method = req.method.toUpperCase();
  const [head, id, sub, ...rest] = path;
  const noRoute = () => Response.json({ error: `no route for ${method} /api/${path.join("/")}` }, { status: 404 });

  try {
    if (method === "GET") {
      if (head === "meta" && path.length === 1) return Response.json(await engine.meta());
      if (head === "workflows" && path.length === 1) return Response.json(await engine.workflows());
      if (head === "workflows" && path.length === 2) return Response.json(await engine.workflow(id!));
      if (head === "pending" && path.length === 1) return Response.json(await engine.pending());
      if (head === "blobs" && path.length === 2) return await blobResponse(engine, id!, q.get("as"));
      if (head === "runs" && path.length === 1) {
        const status = q.get("status") || undefined;
        const workflow = q.get("workflow") || undefined;
        const limit = intParam(q.get("limit"));
        return Response.json(
          await engine.runs({
            ...(status ? { status: status as RunStatus } : {}),
            ...(workflow ? { workflow } : {}),
            ...(limit !== undefined && limit > 0 ? { limit } : {}),
            spend: q.get("spend") === "1",
          }),
        );
      }
      if (head === "runs" && id !== undefined && rest.length === 0) {
        if (sub === undefined) {
          const detail = await engine.run(id);
          if (q.get("detail") === "1") return Response.json(detail);
          // Without ?detail=1 the daemon serves the bare projection.
          const { limits: _limits, inputs: _inputs, ...state } = detail;
          void _limits;
          void _inputs;
          return Response.json(state);
        }
        switch (sub) {
          case "tree":
            return Response.json(await engine.tree(id));
          case "report":
            return new Response(await engine.report(id), { headers: { "content-type": "text/markdown; charset=utf-8" } });
          case "pending":
            return Response.json(await engine.runPending(id));
          case "artifacts":
            return Response.json(await engine.artifacts(id));
          case "patch": {
            const key = q.get("key") ?? undefined;
            return Response.json(await engine.patch(id, { ...(key !== undefined ? { key } : {}), statsOnly: q.get("stats") === "1" }));
          }
          case "events":
            return await eventStream(engine, req, id, q.get("from"));
        }
      }
      return noRoute();
    }

    if (method === "POST") {
      if (head === "runs" && path.length === 1) {
        const body = await jsonBody(req);
        const actor = actorName(req);
        const started = await engine.start(body as unknown as Parameters<WeftBackend["start"]>[0], { actor });
        return Response.json(started, { status: 202 });
      }
      if (head === "runs" && id !== undefined && path.length === 3) {
        switch (sub) {
          case "answer": {
            const body = await jsonBody(req);
            const actor = actorName(req);
            return Response.json(await engine.answer(id, body as unknown as Parameters<WeftBackend["answer"]>[1], actor));
          }
          case "cancel":
            return Response.json(await engine.cancel(id));
          case "resume":
            return Response.json(await engine.resume(id));
        }
      }
      return noRoute();
    }

    return noRoute();
  } catch (err) {
    return fail(err);
  }
}

async function blobResponse(engine: Backend, ref: string, as: string | null): Promise<Response> {
  const text = await engine.blobText(ref);
  const contentType = as === "text" ? "text/plain; charset=utf-8" : as === "json" ? "application/json; charset=utf-8" : "application/octet-stream";
  return new Response(text, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=31536000, immutable",
      "content-disposition": `inline; filename="${ref.slice(0, 12)}"`,
    },
  });
}

/**
 * GET runs/:id/events: `id: <i>` + `data: <JournalRecord>` frames from `from` (or one past
 * Last-Event-ID), then live records as they are appended, a `: heartbeat` every 15 s. Like
 * weft's stream it never ends on its own (a resume appends to the same journal); it ends
 * when the client goes away.
 */
async function eventStream(engine: Backend, req: Request, runId: string, fromParam: string | null): Promise<Response> {
  // 404 before opening a stream for a run nobody has journaled.
  await engine.journal(runId, Number.MAX_SAFE_INTEGER);
  const from = intParam(fromParam);
  const lastSeen = intParam(req.headers.get("last-event-id"));
  const fromIndex = from !== undefined && from >= 0 ? from : lastSeen !== undefined && lastSeen >= 0 ? lastSeen + 1 : 0;

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let next = fromIndex;
      let replaying = true;
      const buffered: JournalRecord[] = [];

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      // Records are sent once each and in order: the replay and the live feed overlap.
      const emit = (record: JournalRecord) => {
        if (record.i < next) return;
        next = record.i + 1;
        send(`id: ${record.i}\ndata: ${JSON.stringify(record)}\n\n`);
      };

      const unsubscribe = engine.subscribe((event) => {
        if (event.runId !== runId) return;
        if (replaying) buffered.push(event.record);
        else emit(event.record);
      });
      const heartbeat = setInterval(() => send(": heartbeat\n\n"), HEARTBEAT_MS);
      const onAbort = () => close();

      function close() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        req.signal.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          // already torn down by the client
        }
      }
      cleanup = close;
      if (req.signal.aborted) {
        close();
        return;
      }
      req.signal.addEventListener("abort", onAbort, { once: true });

      engine
        .journal(runId, fromIndex)
        .then((records) => {
          for (const r of records) emit(r);
          replaying = false;
          for (const r of buffered.splice(0)) emit(r);
        })
        .catch((err: unknown) => {
          send(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n\n`);
          close();
        });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(body, { headers: { ...SSE_HEADERS } });
}
