import "server-only";
/**
 * Shelling out to po-workspace's memory CLI (tools/memory/CONTRACT.md §1, §6). Every spawn is a
 * fresh node + sqlite, so calls run strictly one at a time behind a promise-chain mutex (6.7 GB
 * box). stdout is always exactly one JSON value; non-zero exits carry `{error, code, details,
 * warnings}` and become MemoryCliError. A read command that fails with exit 2 because the derived
 * index is missing triggers one `index build` and one retry.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isMemoryNoteId, type MemoryBuildStats, type MemoryCliErrorPayload } from "@/lib/memory/types";
import { memoryPaths } from "./config";

const execFileAsync = promisify(execFile);

const MAX_BUFFER = 32 * 1024 * 1024;
/** Normal read commands (get/search/stale): plenty for a warm sqlite. */
const NORMAL_TIMEOUT_MS = 20_000;
/** First-ever `index build` may download the ~30 MB bge embeddings model. */
const FIRST_BUILD_TIMEOUT_MS = 240_000;
/** Subsequent builds are incremental. */
const BUILD_TIMEOUT_MS = 60_000;

export class MemoryCliError extends Error {
  constructor(
    message: string,
    /** The CLI's exit/error code: 1 usage, 2 validation/missing index, 3 conflict, 4 secret scan, 5 internal. */
    readonly code: number,
    readonly details: unknown = undefined,
    readonly warnings: string[] = [],
  ) {
    super(message);
    this.name = "MemoryCliError";
  }
}

/** Duck-typed: Next may load this module once per route bundle (see delivery/util.ts). */
export function isMemoryCliError(err: unknown): err is MemoryCliError {
  return err instanceof Error && err.name === "MemoryCliError" && typeof (err as { code?: unknown }).code === "number";
}

/** Throws unless `id` matches the id grammar; called before any id reaches a spawn. */
export function assertMemoryNoteId(id: string): void {
  if (!isMemoryNoteId(id)) throw new MemoryCliError(`"${id}" is not a memory note id (<type>/<slug>)`, 2, { id });
}

interface CliState {
  /** The mutex: every spawn chains onto it, so concurrency is 1 process-wide. */
  chain: Promise<unknown>;
  /** After the first successful build the model is cached and builds get the short timeout. */
  builtOnce: boolean;
  /** How many index builds are in flight (0 or 1 given the mutex); drives the "building" status. */
  building: number;
}

// On globalThis so dev-server HMR (which reloads this module per route bundle) cannot fork the mutex.
const state: CliState = ((globalThis as { __memoryCli?: CliState }).__memoryCli ??= {
  chain: Promise.resolve(),
  builtOnce: false,
  building: 0,
});

/** Whether an `index build` is running right now (status route: indexState "building"). */
export function memoryIndexBuilding(): boolean {
  return state.building > 0;
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = state.chain.then(task, task);
  state.chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function cliPayload(stdout: string): MemoryCliErrorPayload | undefined {
  try {
    const value = JSON.parse(stdout) as unknown;
    if (value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string") return value as MemoryCliErrorPayload;
  } catch {
    // not JSON
  }
  return undefined;
}

/** One spawn, no mutex, no retry. `node <cliPath> <args…>` with cwd = the workspace (never a shell). */
async function spawn<T>(args: string[], timeoutMs: number): Promise<T> {
  const { workspace, cliPath } = memoryPaths();
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("node", [cliPath, ...args], { cwd: workspace, maxBuffer: MAX_BUFFER, timeout: timeoutMs }));
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; killed?: boolean };
    const payload = typeof e.stdout === "string" ? cliPayload(e.stdout) : undefined;
    if (payload) throw new MemoryCliError(payload.error, typeof payload.code === "number" ? payload.code : 5, payload.details, payload.warnings ?? []);
    if (e.killed) throw new MemoryCliError(`memory ${args[0]} timed out after ${timeoutMs} ms`, 5, { args });
    throw new MemoryCliError(`memory ${args[0]} failed: ${e.message ?? String(err)}`, 5, { args });
  }
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new MemoryCliError(`memory ${args[0]} printed something that is not JSON`, 5, { args });
  }
}

function isMissingIndex(err: unknown): boolean {
  if (!isMemoryCliError(err) || err.code !== 2) return false;
  if (/index not found/i.test(err.message)) return true;
  const details = err.details as { hint?: unknown } | undefined;
  return typeof details?.hint === "string" && details.hint.includes("index build");
}

async function buildNow(): Promise<MemoryBuildStats> {
  state.building += 1;
  try {
    const stats = await spawn<MemoryBuildStats>(["index", "build"], state.builtOnce ? BUILD_TIMEOUT_MS : FIRST_BUILD_TIMEOUT_MS);
    state.builtOnce = true;
    return stats;
  } finally {
    state.building -= 1;
  }
}

export interface RunMemoryOptions {
  timeoutMs?: number;
}

/**
 * Run one memory CLI command and parse its JSON. Serialized process-wide; on "index not found"
 * (exit 2) it builds the index once and retries the original command once, all inside the same
 * mutex slot so nothing interleaves with the build.
 */
export function runMemory<T>(args: string[], { timeoutMs = NORMAL_TIMEOUT_MS }: RunMemoryOptions = {}): Promise<T> {
  return enqueue(async () => {
    try {
      return await spawn<T>(args, timeoutMs);
    } catch (err) {
      if (args[0] === "index" || !isMissingIndex(err)) throw err;
      await buildNow();
      return await spawn<T>(args, timeoutMs);
    }
  });
}

/** An explicit (re)build of the derived index, serialized like every other call. */
export function runMemoryBuild(): Promise<MemoryBuildStats> {
  return enqueue(buildNow);
}
