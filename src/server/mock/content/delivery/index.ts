import "server-only";
/**
 * Content registry for the Stage 3-4 mock workflows: which plan a project gets and which code a
 * task produces. Seeded projects get hand-written packs; any other project gets the generic
 * planner and the repo templates, so user-created projects work end to end.
 */
import { agrImpl } from "./agr-code";
import { AGR_PLAN } from "./agr-plan";
import { gateImpl } from "./gate-code";
import { genericPlan } from "./generic-plan";
import { lceImpl } from "./lce-code";
import { LCE_PLAN } from "./lce-plan";
import { PPR_PLAN, TG_PLAN } from "./small-plans";
import { templateImpl } from "./templates";
import { featureFor, projectDomain } from "./templates/domain";
import type { PlanContext, PlanPack, RunTask, TaskImpl } from "./types";

export type { PlanContext, PlanPack, RunTask, TaskImpl } from "./types";

/** Seeded project ids (SPEC section 6) that carry hand-written Stage 3-4 content. */
export const DELIVERY_PACK_PROJECTS = ["agreement-reporting", "compliance-export", "policy-reacceptance", "terms-gate"] as const;

const PLANS: Record<string, PlanPack> = {
  "agreement-reporting": AGR_PLAN,
  "compliance-export": LCE_PLAN,
  "policy-reacceptance": PPR_PLAN,
  "terms-gate": TG_PLAN,
};

/**
 * Drops trace refs the project's documents do not define (a pack written against one BRD must not
 * point at requirements another seed does not have), keeping the task's refs when nothing matches.
 */
function fitTraces(pack: PlanPack, ctx: PlanContext): PlanPack {
  const known = new Set([...ctx.docs.requirements.map((r) => r.id), ...ctx.docs.frs.map((f) => f.id)]);
  if (known.size === 0) return pack;
  return {
    ...pack,
    tasks: pack.tasks.map((t) => {
      const kept = t.traces.filter((r) => known.has(r));
      return { ...t, traces: kept.length ? kept : t.traces };
    }),
  };
}

export function planPackFor(ctx: PlanContext): PlanPack {
  const pack = PLANS[ctx.projectId];
  return pack ? { ...fitTraces(pack, ctx), curated: true } : genericPlan(ctx);
}

export function taskImplFor(projectId: string, task: RunTask): TaskImpl {
  switch (projectId) {
    case "agreement-reporting":
      return agrImpl(task) ?? templateImpl(task);
    case "compliance-export":
      return lceImpl(task) ?? templateImpl(task);
    case "policy-reacceptance":
    case "terms-gate":
      return gateImpl(projectId, task) ?? templateImpl(task);
    default:
      // No hand-written pack: write the code in the project's own domain, not the agreements one.
      return templateImpl(task, { domain: projectDomain(projectId), name: featureFor(task.title, projectDomain(projectId)) });
  }
}
