import type { AssistantTool, ClientFn, ParamKind, ParamSpec, Params, ToolDef } from "./types";

/**
 * Declare a tool. The `const` type parameters keep the name and the `covers` list as literal
 * types, which is what lets tools/index.ts check at compile time that every client function is
 * covered.
 */
export function defineTool<const N extends string, const P extends Params, const C extends readonly ClientFn[]>(def: ToolDef<N, P, C>): AssistantTool<N, C> {
  return def as unknown as AssistantTool<N, C>;
}

const isRequired = (spec: ParamSpec) => spec.required !== false;

const JSON_TYPE: Record<ParamKind, "string" | "number" | "boolean" | "object"> = {
  project: "string",
  stage: "string",
  run: "string",
  task: "string",
  epic: "string",
  requirement: "string",
  change: "string",
  "stage-note": "string",
  doc: "string",
  note: "string",
  workflow: "string",
  person: "string",
  page: "string",
  enum: "string",
  number: "number",
  boolean: "boolean",
  text: "string",
  json: "object",
};

const FIXED_ENUMS: Partial<Record<ParamKind, readonly string[]>> = {
  stage: ["requirements", "architecture", "implementation", "qa", "signoff"],
  doc: ["brd", "aad", "plan"],
  page: ["home", "inbox", "projects", "new-project", "runs", "memory", "settings"],
};

/** A tool's parameters as JSON Schema, the `input_schema` of a model's tool definition. */
export function inputSchema(params: Params): { type: "object"; properties: Record<string, unknown>; required: string[] } {
  const properties: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(params)) {
    const values = spec.kind === "enum" ? spec.values : FIXED_ENUMS[spec.kind];
    properties[name] = { type: JSON_TYPE[spec.kind], description: spec.description, ...(values ? { enum: [...values] } : {}) };
  }
  return { type: "object", properties, required: Object.entries(params).filter(([, s]) => isRequired(s)).map(([n]) => n) };
}

/**
 * The registry as model tool definitions ({ name, description, input_schema }), for a future
 * model-backed brain. Writes say so in the description, so the model knows the person confirms.
 */
export function toolDefinitions(tools: readonly AssistantTool[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.effect === "read" ? t.description : `${t.description} The person confirms before it runs.`,
    input_schema: inputSchema(t.params),
  }));
}

export { isRequired };
