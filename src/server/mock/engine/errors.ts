import "server-only";
/**
 * Error types of the mock engine. StepError mirrors weft's SDK error (code + step ref,
 * serialized into step.failed / run.failed); CancelledError is what a script's pending awaits
 * reject with when its run is cancelled, and the runner swallows it silently.
 */
import type { SerializedStepError, StepErrorCode } from "@/lib/weft/types";
import { WeftApiError } from "./api";

export type StepRef = SerializedStepError["step"];

export class StepError extends Error {
  readonly code: StepErrorCode;
  readonly step: StepRef;
  readonly detail?: unknown;

  constructor(code: StepErrorCode, message: string, opts: { step?: StepRef; detail?: unknown } = {}) {
    super(message);
    this.name = "StepError";
    this.code = code;
    this.step = opts.step ?? {};
    if (opts.detail !== undefined) this.detail = opts.detail;
  }

  serialize(): SerializedStepError {
    return {
      name: "StepError",
      code: this.code,
      message: this.message,
      step: { ...this.step },
      attempts: 1,
      ...(this.detail !== undefined ? { detail: this.detail } : {}),
    };
  }

  /** Wrap anything a script threw; plain errors become code "internal". */
  static from(err: unknown, step: StepRef): StepError {
    if (err instanceof StepError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new StepError("internal", message, { step });
  }
}

export class CancelledError extends StepError {
  constructor(message = "run cancelled", step: StepRef = {}) {
    super("cancelled", message, { step });
    this.name = "CancelledError";
  }
}

export function isCancellation(err: unknown): boolean {
  return err instanceof CancelledError || (err instanceof StepError && err.code === "cancelled");
}

/** weft's daemon rule: 404 when the message says "not found", 400 for everything else. */
export function apiError(message: string): WeftApiError {
  return new WeftApiError(/\bnot found\b/i.test(message) ? 404 : 400, message);
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
