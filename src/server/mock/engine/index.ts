import "server-only";
/**
 * The in-process mock weft engine: journal -> fold -> the daemon's read models, with scripts
 * driven on the demo clock. createMockEngine() returns a MockEngine (WeftBackend + controls);
 * src/server/mock/daemon.ts serves it over HTTP with weft's routes, and the delivery store
 * talks to it through the WeftBackend half only.
 */
import type { DemoSpeed } from "@/lib/delivery/types";
import type { RunStatus } from "@/lib/weft/types";
import type { EngineEvent, MockEngine, MockWorkflow } from "./api";
import { BlobStore } from "./blobs";
import { Clock } from "./clock";
import { apiError } from "./errors";
import { MapWorkspaceFs } from "./fs";
import { isTerminal, type RunEntry } from "./internal";
import { readFrom } from "./journal";
import { artifactsOf, patchOf, pendingOf, runRow } from "./queries";
import { reduceDetail, reduceState } from "./reduce";
import { mockMeta, Registry } from "./registry";
import { renderReport } from "./report";
import { Runner } from "./runner";
import { renderTree } from "./tree";

export { StepError, CancelledError, isCancellation } from "./errors";
export { parseBudget } from "./budget";
export { sha256Hex } from "./blobs";
export { parseDiffStats } from "./patches";
export { reduceState, reduceDetail } from "./reduce";
export { renderTree } from "./tree";
export { renderReport } from "./report";
export { applyDefaults, structuralCheck } from "./validate";
export { DEFAULT_AGENT_ROUTE } from "./ctx";

export interface CreateMockEngineOptions {
  workflows: MockWorkflow[];
  /** Read on every sleep, so a settings change applies to steps already running. */
  speed: () => DemoSpeed;
  /** The workspace after reset(): repo-relative path -> content. */
  initialFiles?: Record<string, string>;
}

const BLOB_REF = /^[0-9a-f]{64}$/;

export function createMockEngine(opts: CreateMockEngineOptions): MockEngine {
  const clock = new Clock(opts.speed);
  const blobs = new BlobStore();
  const initialFiles = { ...(opts.initialFiles ?? {}) };
  const fs = new MapWorkspaceFs(() => clock.now(), initialFiles);
  const registry = new Registry(opts.workflows);

  // Listeners get records in append order, on a microtask after the append, so a listener
  // that calls back into the engine never runs in the middle of a ctx operation.
  const listeners = new Set<(event: EngineEvent) => void>();
  const queue: EngineEvent[] = [];
  let draining = false;
  const drain = () => {
    while (queue.length > 0) {
      const event = queue.shift()!;
      for (const listener of [...listeners]) {
        try {
          const result = listener(event) as unknown;
          if (result instanceof Promise) result.catch((err: unknown) => console.error("[mock-engine] listener failed:", err));
        } catch (err) {
          console.error("[mock-engine] listener failed:", err);
        }
      }
    }
    draining = false;
  };
  const emit = (event: EngineEvent) => {
    if (listeners.size === 0) return;
    queue.push(event);
    if (!draining) {
      draining = true;
      queueMicrotask(drain);
    }
  };

  const runner = new Runner(clock, blobs, fs, registry, emit);
  const stateOf = (runId: string) => reduceState(runner.get(runId).records);

  const engine: MockEngine = {
    // -- WeftBackend ------------------------------------------------------------------------
    async meta() {
      return mockMeta();
    },
    async workflows() {
      return registry.rows();
    },
    async workflow(name) {
      return registry.detail(name);
    },
    async runs(filter = {}) {
      let list: RunEntry[] = [...runner.runs.values()];
      if (filter.status) list = list.filter((r) => r.status === filter.status);
      if (filter.workflow) list = list.filter((r) => r.workflow.id === filter.workflow);
      list.sort((a, b) => (b.records[0]?.at ?? 0) - (a.records[0]?.at ?? 0) || b.order - a.order);
      if (filter.limit !== undefined && filter.limit > 0) list = list.slice(0, filter.limit);
      return list.map((r) => runRow(r, filter.spend ? reduceState(r.records) : undefined));
    },
    async start(body, meta) {
      return runner.start(body, meta);
    },
    async run(runId) {
      return reduceDetail(runner.get(runId).records);
    },
    async journal(runId, from = 0) {
      return readFrom(runner.get(runId).records, from);
    },
    async tree(runId) {
      return renderTree(stateOf(runId));
    },
    async report(runId) {
      return renderReport(stateOf(runId));
    },
    async runPending(runId) {
      return pendingOf(stateOf(runId));
    },
    async pending() {
      const live = [...runner.runs.values()].filter((r) => !isTerminal(r.status));
      const pending = live.flatMap((r) =>
        pendingOf(reduceState(r.records)).map((p) => ({ ...p, workflow: r.workflow.id, rootRunId: r.runId, rootWorkflow: r.workflow.id })),
      );
      // Oldest first: the thing blocked longest is the thing to answer.
      pending.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      return { pending, unreadable: [] };
    },
    async answer(runId, body, actor) {
      return runner.answer(runId, body, actor);
    },
    async cancel(runId) {
      return runner.cancel(runId);
    },
    async resume(runId) {
      return runner.resume(runId);
    },
    async artifacts(runId) {
      const run = runner.get(runId);
      return artifactsOf(reduceState(run.records), run.records, blobs);
    },
    async patch(runId, o) {
      return patchOf(stateOf(runId), blobs, o);
    },
    async blobText(ref) {
      const sha = ref.startsWith("patch:") ? ref.slice("patch:".length) : ref;
      if (!BLOB_REF.test(sha)) throw apiError(`blob ref must be 64 hex characters, got ${JSON.stringify(ref)}`);
      const text = blobs.get(sha);
      if (text === undefined) throw apiError(`blob ${ref} not found`);
      return text;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    // -- MockEngineControls -----------------------------------------------------------------
    fs,
    putBlob: (text) => blobs.put(text),
    metaOf: (runId) => runner.runs.get(runId)?.meta,
    actorOf: (runId, requestId) => runner.runs.get(runId)?.actors.get(requestId),
    fastForward: (runId) => runner.fastForward(runId),
    withVirtualClock: (startAt, fn) => clock.withVirtualClock(startAt, fn),
    now: () => clock.now(),
    waitForHuman: (runId, key) => runner.waitForHuman(runId, key),
    waitForEnd: (runId): Promise<RunStatus> => runner.waitForEnd(runId),
    reset() {
      runner.reset();
      blobs.clear();
      fs.reset(initialFiles);
    },
  };
  return engine;
}
