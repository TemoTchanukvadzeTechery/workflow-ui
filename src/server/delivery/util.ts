import "server-only";
/**
 * Small helpers shared by the delivery modules: errors that map to HTTP statuses, actors, ids,
 * slugs and text trimming. No state lives here.
 */
import type { Actor, StageId } from "@/lib/delivery/types";
import { STAGES } from "@/lib/delivery/types";

/** Thrown by store methods; the router turns it into `{ error }` with this status. */
export class DeliveryError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "DeliveryError";
  }
}

/**
 * Duck-typed: Next may load this module more than once (one copy per route bundle) while the
 * runtime singleton on globalThis was built by another copy, so instanceof is not reliable.
 */
export function isDeliveryError(err: unknown): err is DeliveryError {
  return err instanceof Error && err.name === "DeliveryError" && typeof (err as { status?: unknown }).status === "number";
}

/** Same reasoning for errors the WeftBackend raises. */
export function weftErrorStatus(err: unknown): number | undefined {
  const status = err instanceof Error && err.name === "WeftApiError" ? (err as Error & { status?: unknown }).status : undefined;
  return typeof status === "number" ? status : undefined;
}

export const bad = (message: string) => new DeliveryError(400, message);
export const notFound = (message: string) => new DeliveryError(404, message);
export const conflict = (message: string) => new DeliveryError(409, message);

export const DEFAULT_ACTOR_NAME = "Demo user";

export function human(name: string | undefined): Actor {
  return { kind: "human", name: name?.trim() || DEFAULT_ACTOR_NAME };
}

export function agent(workflow: string, model = "claude-opus-5"): Actor {
  return { kind: "agent", name: `weft · ${workflow}`, model };
}

export const SYSTEM: Actor = { kind: "system" };

export function actorName(actor: Actor): string {
  if (actor.kind === "human" || actor.kind === "agent") return actor.name;
  return actor.kind === "policy" ? "Policy" : "System";
}

export function stageTitle(stage: StageId): string {
  return STAGES.find((s) => s.id === stage)?.title ?? stage;
}

export function nextStageOf(stage: StageId): StageId | undefined {
  const i = STAGES.findIndex((s) => s.id === stage);
  return STAGES[i + 1]?.id;
}

export function prevStageOf(stage: StageId): StageId | undefined {
  const i = STAGES.findIndex((s) => s.id === stage);
  return i > 0 ? STAGES[i - 1].id : undefined;
}

export function stageIndex(stage: StageId): number {
  return STAGES.findIndex((s) => s.id === stage);
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "") || "project"
  );
}

/** First sentence (or the whole text) capped at `max` characters, for titles and summaries. */
export function shorten(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentence = clean.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? clean;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function uniq<T>(items: Iterable<T>): T[] {
  return [...new Set(items)];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
