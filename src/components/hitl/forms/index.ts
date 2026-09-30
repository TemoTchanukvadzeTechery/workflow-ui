/**
 * Bespoke forms by request key prefix (SPEC 5.4). A form is used only when the request's schema
 * still has the shape it was written for; otherwise the card falls back to the SchemaForm, so a
 * changed workflow never gets a form that posts answers its schema rejects.
 */
import type { ComponentType } from "react";
import { enumValues } from "@/lib/weft/schema-form";
import type { PlannedTask } from "@/lib/weft/workflows";
import type { RequestFormProps, RequestView } from "../types";
import { DependencyReviewForm } from "./DependencyReviewForm";
import { DocReviewForm } from "./DocReviewForm";
import { MemoryReviewForm } from "./MemoryReviewForm";
import { PlanReviewForm } from "./PlanReviewForm";
import { QaReviewForm } from "./QaReviewForm";
import { TaskReviewForm } from "./TaskReviewForm";

export { DependencyReviewForm, DocReviewForm, MemoryReviewForm, PlanReviewForm, QaReviewForm, TaskReviewForm };
export { GenericRequestForm } from "./GenericRequestForm";
export { PlanTasksTable, START_MODE_LABELS, type StartMode } from "./PlanReviewForm";
export { QaVerdictLabel, QA_VERDICT_META } from "./QaReviewForm";

export type BespokeFormProps = RequestFormProps & { editedTasks?: PlannedTask[]; stale?: string[] };

export type BespokeFormName = "dependency-review" | "doc-review" | "memory-review" | "plan-review" | "task-review" | "qa-review";

function has(request: RequestView, key: string, values: string[]): boolean {
  const got = enumValues(request.schema, key);
  return values.every((v) => got.includes(v));
}

const FORMS: Array<{ name: BespokeFormName; prefix: string; fits: (r: RequestView) => boolean; Component: ComponentType<BespokeFormProps> }> = [
  { name: "dependency-review", prefix: "deps:review:", fits: (r) => has(r, "decision", ["continue", "search-more"]), Component: DependencyReviewForm },
  { name: "memory-review", prefix: "memory:review", fits: (r) => has(r, "decision", ["apply", "discard"]), Component: MemoryReviewForm },
  { name: "plan-review", prefix: "plan:review:", fits: (r) => has(r, "decision", ["approve", "revise"]), Component: PlanReviewForm },
  { name: "task-review", prefix: "task:review:", fits: (r) => has(r, "decision", ["approve", "request-changes"]), Component: TaskReviewForm },
  { name: "qa-review", prefix: "qa:review:", fits: (r) => has(r, "verdict", ["ready-for-po-review", "bugs-found", "blocked"]), Component: QaReviewForm },
  { name: "doc-review", prefix: "review:", fits: (r) => has(r, "decision", ["accept", "revise"]), Component: DocReviewForm },
];

/** The bespoke form for a request, or null for the generic SchemaForm. */
export function pickRequestForm(request: RequestView): { name: BespokeFormName; Component: ComponentType<BespokeFormProps> } | null {
  const key = request.key;
  if (!key) return null;
  const hit = FORMS.find((f) => key.startsWith(f.prefix));
  return hit && hit.fits(request) ? { name: hit.name, Component: hit.Component } : null;
}
