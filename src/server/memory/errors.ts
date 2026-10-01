import "server-only";
/**
 * A request the memory router answers with a 4xx and `{ error }`: a malformed sha, cursor or path
 * (400), or a commit that is not in the vault's history (404). Thrown by health.ts and history.ts.
 */

export class MemoryRequestError extends Error {
  constructor(
    /** The HTTP status the router answers with (400, 404). */
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MemoryRequestError";
  }
}

/** Duck-typed: Next may load this module once per route bundle (see delivery/util.ts). */
export function isMemoryRequestError(err: unknown): err is MemoryRequestError {
  return err instanceof Error && err.name === "MemoryRequestError" && typeof (err as { status?: unknown }).status === "number";
}
