import "server-only";
/**
 * WeftBackend over a real weft daemon's HTTP API (http://127.0.0.1:4781/api/...), the swap
 * for the mock engine once po-brd / architect-aad run for real. Same method names as the
 * daemon's endpoints; errors come back as WeftApiError with the daemon's status and text.
 *
 * Two things the daemon has no endpoint for, done best effort:
 * - journal(runId, from): reads the run's SSE stream from `from` up to the record count the
 *   run state reports, then closes it.
 * - subscribe(): polls GET /api/runs every 2 s and follows GET /api/runs/:id/events for every
 *   run that is not terminal (and for runs first seen after the first poll, from record 0).
 *   Runs already running when subscribe() is called are followed from their current end.
 *   A stream is closed on the run's terminal record and reopened if a later poll shows the run
 *   live again (a resume). Events carry the StartMeta and actor only when this process
 *   started the run / sent the answer, since weft records neither.
 */
import {
  TERMINAL_RUN_STATUSES,
  type AnswerBody,
  type ArtifactEntry,
  type JournalRecord,
  type Meta,
  type PatchResponse,
  type PendingRequest,
  type PendingResponse,
  type RunDetail,
  type RunRow,
  type RunStatus,
  type StartRunBody,
  type TreePhase,
  type WorkflowDetail,
  type WorkflowRow,
} from "@/lib/weft/types";
import { WeftApiError, type EngineEvent, type StartMeta, type WeftBackend } from "../mock/engine/api";
import { daemonUrl } from "./proxy";

export const DEFAULT_WEFT_DAEMON = "http://127.0.0.1:4781";

const TERMINAL: ReadonlySet<RunStatus> = new Set(TERMINAL_RUN_STATUSES);
const TERMINAL_EVENTS = new Set(["run.completed", "run.failed", "run.cancelled"]);

type Query = Record<string, string | number | boolean | undefined>;

interface SseFrame {
  event?: string;
  id?: string;
  data: string;
}

/** Parse an SSE body into frames; comments (": heartbeat") are skipped. */
async function* sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
      let cut: number;
      while ((cut = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const frame: SseFrame = { data: "" };
        const data: string[] = [];
        for (const line of block.split("\n")) {
          if (line === "" || line.startsWith(":")) continue;
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
          if (field === "data") data.push(value);
          else if (field === "event") frame.event = value;
          else if (field === "id") frame.id = value;
        }
        if (data.length === 0) continue;
        frame.data = data.join("\n");
        yield frame;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export class HttpWeftBackend implements WeftBackend {
  private readonly metaByRun = new Map<string, StartMeta>();
  private readonly actorByAnswer = new Map<string, string>();

  constructor(
    readonly base: string = process.env.WEFT_DAEMON ?? DEFAULT_WEFT_DAEMON,
    private readonly pollMs = 2_000,
  ) {}

  private url(path: string[], query: Query = {}): string {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === false || v === "") continue;
      sp.set(k, v === true ? "1" : String(v));
    }
    const s = sp.toString();
    return daemonUrl(this.base, path, s ? `?${s}` : "");
  }

  private async send(method: "GET" | "POST", path: string[], opts: { query?: Query; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<Response> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(this.url(path, opts.query), {
        method,
        headers,
        cache: "no-store",
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      throw new WeftApiError(502, `weft daemon unreachable at ${this.base}`);
    }
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const data = (await res.json()) as { error?: string };
        if (data?.error) message = data.error;
      } catch {
        // not JSON
      }
      throw new WeftApiError(res.status, message);
    }
    return res;
  }

  private async json<T>(method: "GET" | "POST", path: string[], opts: { query?: Query; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
    return (await (await this.send(method, path, { ...opts, headers: { accept: "application/json", ...(opts.headers ?? {}) } })).json()) as T;
  }

  private async text(path: string[], query: Query, accept: string): Promise<string> {
    return (await this.send("GET", path, { query, headers: { accept } })).text();
  }

  meta(): Promise<Meta> {
    return this.json("GET", ["meta"]);
  }

  workflows(): Promise<WorkflowRow[]> {
    return this.json("GET", ["workflows"]);
  }

  workflow(name: string): Promise<WorkflowDetail> {
    return this.json("GET", ["workflows", name]);
  }

  runs(filter: { status?: RunStatus; workflow?: string; limit?: number; spend?: boolean } = {}): Promise<RunRow[]> {
    return this.json("GET", ["runs"], { query: { status: filter.status, workflow: filter.workflow, limit: filter.limit, spend: filter.spend } });
  }

  async start(body: StartRunBody, meta?: StartMeta): Promise<{ ok: true; runId: string; workflow: string }> {
    const started = await this.json<{ ok: true; runId: string; workflow: string }>("POST", ["runs"], { body });
    if (meta) this.metaByRun.set(started.runId, { ...meta });
    return started;
  }

  run(runId: string): Promise<RunDetail> {
    return this.json("GET", ["runs", runId], { query: { detail: true } });
  }

  async journal(runId: string, from = 0): Promise<JournalRecord[]> {
    const { records: total } = await this.run(runId);
    if (from >= total) return [];
    const out: JournalRecord[] = [];
    const abort = new AbortController();
    // The stream never closes by itself; stop at the last record the state counted.
    const timeout = setTimeout(() => abort.abort(), 10_000);
    try {
      const res = await this.send("GET", ["runs", runId, "events"], { query: { from }, headers: { accept: "text/event-stream" }, signal: abort.signal });
      if (!res.body) return out;
      for await (const frame of sseFrames(res.body)) {
        if (frame.event !== undefined) continue;
        const record = JSON.parse(frame.data) as JournalRecord;
        out.push(record);
        if (record.i >= total - 1) break;
      }
    } catch (err) {
      if (!abort.signal.aborted) throw err;
    } finally {
      clearTimeout(timeout);
      abort.abort();
    }
    return out;
  }

  tree(runId: string): Promise<TreePhase[]> {
    return this.json("GET", ["runs", runId, "tree"]);
  }

  report(runId: string): Promise<string> {
    return this.text(["runs", runId, "report"], {}, "text/markdown");
  }

  runPending(runId: string): Promise<PendingRequest[]> {
    return this.json("GET", ["runs", runId, "pending"]);
  }

  pending(): Promise<PendingResponse> {
    return this.json("GET", ["pending"]);
  }

  async answer(runId: string, body: AnswerBody, actor?: string): Promise<{ ok: true; woke: boolean }> {
    // Recorded before sending: the answer's record can arrive on the event stream first.
    const key = `${runId}\u0000${body.requestId}`;
    const previous = this.actorByAnswer.get(key);
    if (actor) this.actorByAnswer.set(key, actor);
    try {
      return await this.json<{ ok: true; woke: boolean }>("POST", ["runs", runId, "answer"], {
        body,
        ...(actor ? { headers: { "x-actor": actor } } : {}),
      });
    } catch (err) {
      if (previous === undefined) this.actorByAnswer.delete(key);
      else this.actorByAnswer.set(key, previous);
      throw err;
    }
  }

  cancel(runId: string): Promise<{ ok: true }> {
    return this.json("POST", ["runs", runId, "cancel"], { body: {} });
  }

  resume(runId: string): Promise<{ ok: true; runId: string }> {
    return this.json("POST", ["runs", runId, "resume"], { body: {} });
  }

  artifacts(runId: string): Promise<ArtifactEntry[]> {
    return this.json("GET", ["runs", runId, "artifacts"]);
  }

  patch(runId: string, opts: { key?: string; statsOnly?: boolean } = {}): Promise<PatchResponse> {
    return this.json("GET", ["runs", runId, "patch"], { query: { key: opts.key, stats: opts.statsOnly } });
  }

  blobText(ref: string): Promise<string> {
    return this.text(["blobs", ref], { as: "text" }, "text/plain");
  }

  subscribe(listener: (event: EngineEvent) => void): () => void {
    let stopped = false;
    let firstPoll = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const known = new Set<string>();
    const watches = new Map<string, { abort: AbortController; next: number; open: boolean; workflow: string }>();

    const deliver = (runId: string, workflow: string, record: JournalRecord) => {
      const actor = record.ev.type === "human.answered" ? this.actorByAnswer.get(`${runId}\u0000${record.ev.id}`) : undefined;
      try {
        listener({ runId, record, workflow, meta: this.metaByRun.get(runId) ?? {}, ...(actor ? { actor } : {}) });
      } catch (err) {
        console.error("[weft-http] listener failed:", err);
      }
    };

    const follow = (runId: string, workflow: string, from: number) => {
      const watch = { abort: new AbortController(), next: from, open: true, workflow };
      watches.set(runId, watch);
      void (async () => {
        try {
          const res = await this.send("GET", ["runs", runId, "events"], {
            query: { from },
            headers: { accept: "text/event-stream" },
            signal: watch.abort.signal,
          });
          if (!res.body) return;
          for await (const frame of sseFrames(res.body)) {
            if (stopped || frame.event !== undefined) continue;
            const record = JSON.parse(frame.data) as JournalRecord;
            if (record.i < watch.next) continue;
            watch.next = record.i + 1;
            deliver(runId, workflow, record);
            if (TERMINAL_EVENTS.has(record.ev.type)) break;
          }
        } catch {
          // A dropped stream is picked up again by the next poll.
        } finally {
          watch.open = false;
          watch.abort.abort();
        }
      })();
    };

    const poll = async () => {
      try {
        const rows = await this.runs({});
        for (const row of rows) {
          const isNew = !known.has(row.runId);
          known.add(row.runId);
          const watch = watches.get(row.runId);
          const terminal = TERMINAL.has(row.status);
          if (watch) {
            if (!watch.open && !terminal) follow(row.runId, row.workflow, watch.next);
          } else if (!firstPoll && isNew) {
            follow(row.runId, row.workflow, 0);
          } else if (!terminal) {
            // Already running when we started watching (or resumed since): follow from its end.
            follow(row.runId, row.workflow, (await this.run(row.runId)).records);
          }
        }
        firstPoll = false;
      } catch (err) {
        if (!(err instanceof WeftApiError && err.status === 502)) console.error("[weft-http] poll failed:", err);
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), this.pollMs);
      }
    };
    void poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      for (const w of watches.values()) w.abort.abort();
      watches.clear();
    };
  }
}
