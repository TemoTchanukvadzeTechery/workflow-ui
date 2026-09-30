import "server-only";
/**
 * zod schemas for the SPEC workflows' input and output. weft derives WorkflowDetail.input from
 * the workflow's zod schema (zod 4 toJSONSchema), so the mock does the same; parseInput applies
 * defaults the way weft's zod parse does and turns failures into a 400 with weft-like text.
 */
import { z } from "zod";
import type { DevPlanInput, DevTaskInput, PlannedTask, QaVerifyInput } from "@/lib/weft/workflows";
import type { JsonSchema } from "@/lib/weft/types";
import { WeftApiError } from "../../engine/api";

const criterion = z.object({ id: z.string().min(1), text: z.string().min(1) });

export const plannedTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  tags: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  relatedFiles: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(criterion).default([]),
  epicId: z.string().default(""),
  type: z.enum(["story", "task", "bug", "spike"]).default("task"),
  repo: z.string().min(1),
  size: z.enum(["XS", "S", "M", "L"]).default("M"),
  team: z.string().default("Customer Guardians"),
  wave: z.number().int().min(1).default(1),
  traces: z.array(z.string()).default([]),
  blockedBy: z.string().optional(),
});

const runTaskSchema = plannedTaskSchema.extend({
  jiraKey: z.string().nullable().default(null),
  branch: z.string().default(""),
});

export const devPlanInputSchema = z
  .object({
    projectId: z.string().min(1).describe("Delivery project id"),
    brd: z.string().default("").describe("Accepted BRD path in the workspace"),
    aad: z.string().default("").describe("Accepted AAD path in the workspace"),
    out: z.string().default("").describe("Where to write the plan (default plan/<projectId>.md)"),
    notes: z.array(z.string()).default([]).describe("Developer notes: note file paths or inline text"),
    epics: z
      .array(
        z.object({
          id: z.string(),
          key: z.string().nullable().default(null),
          title: z.string(),
          brdRequirementRefs: z.array(z.string()).default([]),
          aadRefs: z.array(z.string()).default([]),
          systems: z.array(z.string()).default([]),
        }),
      )
      .default([])
      .describe("Accepted epics the tasks hang under"),
    maxRounds: z.number().int().min(1).max(5).default(3).describe("Planning rounds before giving up"),
  })
  .refine((v) => v.brd || v.aad || v.epics.length > 0, {
    message: "Provide the accepted BRD path in brd, the AAD path in aad, or at least one epic.",
  });

export const devTaskInputSchema = z.object({
  projectId: z.string().min(1),
  task: runTaskSchema,
  attempt: z.number().int().min(1).default(1).describe("Run attempt for this task; a QA loop-back starts attempt 2, 3, …"),
  feedback: z.string().optional().describe("Feedback carried into this run, e.g. QA bugs"),
  notes: z.array(z.string()).optional().describe("Developer notes for this task: the stage's general notes plus the ones that name it"),
  origin: z.enum(["plan", "qa"]).default("plan"),
  maxReworkCycles: z.number().int().min(0).max(5).default(2).describe("Rework cycles before the review is escalated"),
});

export const qaVerifyInputSchema = z.object({
  projectId: z.string().min(1),
  task: runTaskSchema,
  attempt: z.number().int().min(1).default(1),
  environment: z.string().default("internal-apps-test"),
  readyForTest: z.string().optional().describe("The Ready-for-test handoff note from the Implementation gate"),
});

const stats = z.object({ adds: z.number(), dels: z.number(), files: z.number() });
const planReport = z.object({
  assumptions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  uncovered: z.array(z.string()),
  risks: z.array(z.string()),
  uncoveredSystems: z.array(z.string()).optional(),
  notesNotApplied: z.array(z.string()).optional(),
});

export const devPlanOutputSchema = z.object({
  path: z.string(),
  approved: z.boolean(),
  rounds: z.number().int(),
  tasks: z.array(plannedTaskSchema),
  start: z.enum(["all-waves", "first-wave", "manual"]),
  report: planReport,
});

export const devTaskOutputSchema = z.object({
  taskId: z.string(),
  approved: z.boolean(),
  cancelled: z.boolean(),
  escalated: z.boolean(),
  reworkCycles: z.number().int(),
  diffStats: stats,
  checks: z.array(z.object({ name: z.string(), status: z.enum(["pass", "fail"]) }).loose()),
});

export const qaVerifyOutputSchema = z.object({
  taskId: z.string(),
  verdict: z.enum(["ready-for-po-review", "bugs-found", "blocked"]),
  bugs: z.array(z.string()),
  comment: z.string(),
});

export function jsonSchema(schema: z.ZodType, io: "input" | "output" = "input"): JsonSchema {
  const out = z.toJSONSchema(schema, { io, unrepresentable: "any" }) as JsonSchema;
  delete out.$schema;
  return out;
}

function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown): T {
  const res = schema.safeParse(raw ?? {});
  if (res.success) return res.data;
  const issue = res.error.issues[0];
  const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
  throw new WeftApiError(400, `invalid input: ${where}${issue.message}`);
}

export function parseDevPlanInput(raw: unknown): DevPlanInput {
  const v = parseOrThrow(devPlanInputSchema, raw);
  return { ...v, out: v.out || `plan/${v.projectId}.md` };
}

export function parseDevTaskInput(raw: unknown): DevTaskInput {
  const v = parseOrThrow(devTaskInputSchema, raw);
  return { ...v, task: withBranch(v.task) };
}

export function parseQaVerifyInput(raw: unknown): QaVerifyInput {
  const v = parseOrThrow(qaVerifyInputSchema, raw);
  return { ...v, task: withBranch(v.task) };
}

/** Branch naming per handbook-code: <type>-<KEY>-<slug>. The store usually passes one. */
function withBranch<T extends PlannedTask & { jiraKey: string | null; branch: string }>(task: T): T {
  if (task.branch) return task;
  const slug = task.title
    .replace(/^\s*\[[^\]]+\]\s*/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .slice(0, 5)
    .join("-");
  return { ...task, branch: `${task.type === "bug" ? "bugfix" : "feature"}-${task.jiraKey ?? task.id}-${slug}` };
}

/**
 * Validates an edited task list from a plan review answer. Returns undefined when the shape is
 * wrong (the caller then keeps the proposal), and drops dependencies on unknown task ids.
 */
export function validatePlannedTasks(raw: unknown): PlannedTask[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const res = z.array(plannedTaskSchema).safeParse(raw);
  if (!res.success) return undefined;
  const ids = new Set<string>();
  for (const t of res.data) {
    if (ids.has(t.id)) return undefined;
    ids.add(t.id);
  }
  return res.data.map((t) => {
    const task: PlannedTask = { ...t, dependencies: t.dependencies.filter((d) => ids.has(d) && d !== t.id) };
    if (t.blockedBy === undefined) delete task.blockedBy;
    return task;
  });
}
