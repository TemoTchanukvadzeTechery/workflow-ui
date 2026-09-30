/**
 * A human request's form, derived from the JSON Schema of the answer it expects. Pure port of
 * weft/apps/ui/src/domain/adapt.ts (schemaQuestions, controlOf, optionsOf, gateAnswer,
 * requiredFieldsMissing, DENIABLE), so a workflow this UI has never seen still gets a usable
 * form and the answer JSON is exactly what weft's own UI would post.
 *
 * Differences from weft, all additive: a "number" control for number/integer (weft renders a
 * text field with type=number), feedback|guidance|comment also count as prose keys, list
 * textareas split on newlines only (weft also splits on commas, which breaks note text such as
 * "Legal confirmed aggregate-only, no PII"), and the confirm token is added for kind "confirm".
 */
import type { HumanKind, JsonSchema } from "./types";

export type SchemaControl = "toggle" | "cards" | "chips" | "choice" | "select" | "list" | "note" | "number" | "text";

export interface SchemaOption {
  /** The value sent in the answer (enum member or const). */
  value: string;
  /** Shown on the control; the value itself unless the branch has a title. */
  label: string;
  /** Branch description; non-empty on any branch makes the field render as cards. */
  description: string;
}

export interface SchemaQuestion {
  key: string;
  label: string;
  control: SchemaControl;
  options: SchemaOption[];
  required: boolean;
  description?: string;
  default?: unknown;
  /** The property's own schema, for min/max and item types. */
  property: JsonSchema;
}

/** Values held by the form while it is being filled; buildAnswer turns them into the answer. */
export type SchemaFormValues = Record<string, unknown>;

/** Kinds whose two buttons are the verdict: `ctx.human.approve` declares `{ approved, note }`. */
export const DENIABLE: ReadonlySet<HumanKind> = new Set<HumanKind>(["approve", "confirm"]);
/** The field `ctx.human.approve` declares for the verdict itself. */
export const VERDICT_FIELD = "approved";
/** The field a `confirm` request carries its token in. */
export const CONFIRM_FIELD = "confirm";

export function isDeniable(kind: HumanKind): boolean {
  return DENIABLE.has(kind);
}

const PROSE_KEY = /note|detail|reason|message|description|feedback|guidance|comment/i;

type Prop = JsonSchema & {
  type?: string | string[];
  title?: string;
  description?: string;
  enum?: unknown[];
  anyOf?: Prop[];
  oneOf?: Prop[];
  const?: unknown;
  items?: Prop;
  default?: unknown;
  minimum?: number;
  maximum?: number;
};

function propsOf(schema: JsonSchema | null | undefined): Record<string, Prop> | undefined {
  const properties = (schema as { properties?: unknown } | null | undefined)?.properties;
  return properties && typeof properties === "object" ? (properties as Record<string, Prop>) : undefined;
}

function requiredOf(schema: JsonSchema | null | undefined): string[] {
  const required = (schema as { required?: unknown } | null | undefined)?.required;
  return Array.isArray(required) ? required.filter((k): k is string => typeof k === "string") : [];
}

function typeOf(property: Prop): string | undefined {
  if (Array.isArray(property.type)) return property.type.find((t) => t !== "null");
  return property.type;
}

/** "newNotes" -> "New notes", "maxQueries" -> "Max queries". */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Enum members, or anyOf/oneOf branches that are all consts, of a property or its items. */
export function optionsOf(property: JsonSchema): SchemaOption[] {
  const p = property as Prop;
  const source: Prop = typeOf(p) === "array" ? (p.items ?? {}) : p;
  if (Array.isArray(source.enum)) {
    return source.enum.map((value) => ({ value: String(value), label: String(value), description: "" }));
  }
  const branches = source.anyOf ?? source.oneOf;
  if (Array.isArray(branches)) {
    const consts = branches.filter((branch) => branch.const !== undefined);
    if (consts.length === branches.length && consts.length > 0) {
      return consts.map((branch) => ({
        value: String(branch.const),
        label: typeof branch.title === "string" ? branch.title : String(branch.const),
        description: typeof branch.description === "string" ? branch.description : "",
      }));
    }
  }
  return [];
}

/** The control for one property. Chosen from the declaration; the key only promotes text to a note. */
export function controlOf(key: string, property: JsonSchema, options: SchemaOption[] = optionsOf(property)): SchemaControl {
  const p = property as Prop;
  const type = typeOf(p);
  if (type === "boolean") return "toggle";
  if (options.length > 0) {
    if (options.some((option) => option.description !== "")) return "cards";
    if (type === "array") return "chips";
    return options.length > 4 ? "select" : "choice";
  }
  if (type === "array") return "list";
  if (typeof p.description === "string" && p.description.length > 60) return "note";
  if (PROSE_KEY.test(key)) return "note";
  if (type === "number" || type === "integer") return "number";
  return "text";
}

export interface SchemaQuestionsOptions {
  /** Hide the verdict field of deniable kinds (the buttons are the verdict), and the confirm token. */
  kind?: HumanKind;
  /** Extra keys to leave out (a bespoke form renders them itself). */
  omit?: readonly string[];
}

export function schemaQuestions(schema: JsonSchema | null | undefined, opts: SchemaQuestionsOptions = {}): SchemaQuestion[] {
  const properties = propsOf(schema);
  if (!properties) return [];
  const required = new Set(requiredOf(schema));
  const deniable = opts.kind ? isDeniable(opts.kind) : false;
  const omit = new Set(opts.omit ?? []);
  return Object.entries(properties)
    .filter(([key]) => !omit.has(key))
    .filter(([key]) => !(deniable && key === VERDICT_FIELD))
    .filter(([key]) => !(opts.kind === "confirm" && key === CONFIRM_FIELD))
    .map(([key, property]) => {
      const options = optionsOf(property);
      return {
        key,
        label: typeof property.title === "string" ? property.title : humanizeKey(key),
        control: controlOf(key, property, options),
        options,
        required: required.has(key),
        ...(typeof property.description === "string" ? { description: property.description } : {}),
        ...(property.default !== undefined ? { default: property.default } : {}),
        property,
      };
    });
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/**
 * The answer as the workflow sees it once its schema defaults are applied (zod `.default()`),
 * e.g. DEPENDENCY_REVIEW_SCHEMA -> { add: [], remove: [], guidance: "" }. Useful for previews;
 * post buildAnswer's output, not this.
 */
export function defaultAnswer(schema: JsonSchema | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(propsOf(schema) ?? {})) {
    if (property.default !== undefined) out[key] = clone(property.default);
  }
  return out;
}

/** `answer` with the schema's defaults filled in for missing keys. */
export function withDefaults(schema: JsonSchema | null | undefined, answer: unknown): unknown {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) return answer;
  return { ...defaultAnswer(schema), ...(answer as Record<string, unknown>) };
}

/** Initial form values: each question's default, shaped for its control. */
export function defaultValues(schema: JsonSchema | null | undefined, opts: SchemaQuestionsOptions = {}): SchemaFormValues {
  const values: SchemaFormValues = {};
  for (const q of schemaQuestions(schema, opts)) {
    const d = q.default;
    switch (q.control) {
      case "toggle":
        values[q.key] = d === true;
        break;
      case "chips":
        values[q.key] = Array.isArray(d) ? d.map(String) : [];
        break;
      case "list":
        values[q.key] = Array.isArray(d) ? d.map(String).join("\n") : "";
        break;
      case "number":
        values[q.key] = typeof d === "number" ? String(d) : "";
        break;
      default:
        values[q.key] = d === undefined || d === null ? "" : String(d);
    }
  }
  return values;
}

/** One entry per non-empty line, trimmed. */
export function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export interface BuildAnswerOptions {
  kind?: HumanKind;
  confirmToken?: string;
  /** Deniable kinds: the button pressed. */
  approved?: boolean;
}

/**
 * The answer object to POST, from the form values and the schema's own types (weft gateAnswer).
 * Empty strings and empty lists are left out, so the workflow's defaults apply; numbers are
 * parsed; list text becomes one item per line.
 */
export function buildAnswer(schema: JsonSchema | null | undefined, values: SchemaFormValues, opts: BuildAnswerOptions = {}): Record<string, unknown> {
  const properties = propsOf(schema);
  const out: Record<string, unknown> = {};
  if (!properties) {
    Object.assign(out, values);
  } else {
    for (const [key, property] of Object.entries(properties)) {
      const value = values[key];
      if (value === undefined || value === "") continue;
      const type = typeOf(property);
      if (type === "number" || type === "integer") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) out[key] = type === "integer" ? Math.trunc(parsed) : parsed;
        continue;
      }
      if (type === "array") {
        const raw = typeof value === "string" ? splitLines(value) : Array.isArray(value) ? value : [value];
        const itemType = property.items ? typeOf(property.items) : undefined;
        const items = raw
          .map((item) => (typeof item === "string" ? item.trim() : item))
          .filter((item) => item !== "" && item !== undefined && item !== null)
          .map((item) => {
            if (itemType !== "number" && itemType !== "integer") return item;
            const parsed = Number(item);
            return Number.isFinite(parsed) ? parsed : item;
          });
        if (items.length > 0) out[key] = items;
        continue;
      }
      if (type === "string" && typeof value === "string" && value.trim() === "") continue;
      out[key] = value;
    }
  }
  if (opts.kind && isDeniable(opts.kind) && opts.approved !== undefined) out[VERDICT_FIELD] = opts.approved;
  if (opts.kind === "confirm" && opts.confirmToken) out[CONFIRM_FIELD] = opts.confirmToken;
  return out;
}

/** weft's name for buildAnswer. */
export const gateAnswer = buildAnswer;

/** Required keys the answer does not fill (empty strings and empty lists count as missing). */
export function missingRequired(schema: JsonSchema | null | undefined, answer: unknown): string[] {
  const required = requiredOf(schema);
  if (required.length === 0) return [];
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) return [...required];
  const record = answer as Record<string, unknown>;
  return required.filter((key) => {
    const field = record[key];
    return field === undefined || field === "" || (Array.isArray(field) && field.length === 0);
  });
}

/** The enum values a property accepts (enum or anyOf consts), e.g. to detect an escalated review. */
export function enumValues(schema: JsonSchema | null | undefined, key: string): string[] {
  const property = propsOf(schema)?.[key];
  return property ? optionsOf(property).map((o) => o.value) : [];
}
