/**
 * GET /api/delivery/daemon-probe: whether the weft daemon in settings.weftDaemon answers
 * GET /api/meta. Settings asks before switching the shared data source to it, since every viewer
 * of this server loses /api/weft when no daemon runs. Only the saved URL is probed.
 */
import { getRuntime } from "@/server/runtime";
import { daemonUrl } from "@/server/weft/proxy";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let url = "";
  try {
    const rt = getRuntime();
    await rt.ready;
    url = rt.settings().weftDaemon;
    const res = await fetch(daemonUrl(url, ["meta"]), { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(3_000) });
    if (!res.ok) return Response.json({ ok: false, url, error: `The daemon at ${url} answered ${res.status}.` });
    const meta = (await res.json().catch(() => null)) as { version?: unknown } | null;
    return Response.json({ ok: true, url, ...(typeof meta?.version === "string" ? { version: meta.version } : {}) });
  } catch {
    return Response.json({ ok: false, url, error: url ? `No weft daemon answered at ${url}.` : "Could not read the settings." });
  }
}
