/**
 * /api/events: one SSE stream per browser tab (SPEC 3.3). Every LiveEvent from the bus goes out
 * as `event: change`; a comment heartbeat every 15 s keeps proxies from closing the stream.
 */
import { getRuntime } from "@/server/runtime";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;

export async function GET(req: Request): Promise<Response> {
  const { bus } = getRuntime();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = bus.subscribe((event) => send(`event: change\ndata: ${JSON.stringify(event)}\n\n`));
      const heartbeat = setInterval(() => send(": heartbeat\n\n"), HEARTBEAT_MS);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        req.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      req.signal.addEventListener("abort", cleanup);
      // Reconnect after 2 s if the stream drops; an initial comment flushes the headers.
      send("retry: 2000\n: connected\n\n");
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
