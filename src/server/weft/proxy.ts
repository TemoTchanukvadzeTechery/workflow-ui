import "server-only";
/**
 * Forward /api/weft/* to a real weft daemon (settings.dataSource === "weft").
 *
 * A server-side fetch is the only way in: the daemon has no CORS and refuses any request whose
 * Origin is not its own host:port (app.ts origin guard), so a Next rewrite, which forwards the
 * browser's Origin, gets a 403. Only accept, content-type and last-event-id are passed on, plus
 * the body; SSE is streamed straight through and ends when the browser disconnects.
 */

const FORWARDED_HEADERS = ["accept", "content-type", "last-event-id"] as const;
const PASSED_BACK_HEADERS = ["content-type", "cache-control", "content-disposition"] as const;

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
} as const;

export function daemonUrl(base: string, path: string[], search = ""): string {
  return `${base.replace(/\/+$/, "")}/api/${path.map(encodeURIComponent).join("/")}${search}`;
}

export async function proxyToDaemon(req: Request, path: string[], base: string): Promise<Response> {
  const target = daemonUrl(base, path, new URL(req.url).search);
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const method = req.method.toUpperCase();
  const init: RequestInit = { method, headers, signal: req.signal, cache: "no-store", redirect: "manual" };
  if (method !== "GET" && method !== "HEAD") init.body = await req.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    // The browser went away mid-request: nobody is reading this response.
    if (req.signal.aborted) return new Response(null, { status: 499 });
    void err;
    return Response.json({ error: `weft daemon unreachable at ${base}` }, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (contentType.startsWith("text/event-stream")) {
    return new Response(upstream.body, { status: upstream.status, headers: { ...SSE_HEADERS } });
  }
  const out = new Headers();
  for (const name of PASSED_BACK_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
