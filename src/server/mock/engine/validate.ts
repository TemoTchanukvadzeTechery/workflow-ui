import "server-only";
/**
 * The JSON Schema subset weft's daemon checks answers against (port of core/src/jsonschema.ts
 * structuralCheck): type, enum, const, anyOf, required, properties, additionalProperties:false,
 * items, and the string/number/array constraint keywords. Plus defaults application, which in
 * weft is zod's .default() on the script side: the journal keeps the raw answer and the script
 * sees the defaulted one.
 */
import type { JsonSchema } from "@/lib/weft/types";
import { WeftApiError } from "./api";

export interface SchemaIssue {
  path: string;
  message: string;
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function structuralCheck(schemaJson: unknown, value: unknown, path = ""): SchemaIssue[] {
  if (!isObj(schemaJson)) return [];
  const s = schemaJson;
  const issues: SchemaIssue[] = [];
  const type = s.type as string | string[] | undefined;

  if (Array.isArray(s.enum)) {
    if (!s.enum.some((e) => deepEqual(e, value))) {
      issues.push({ path, message: `expected one of ${s.enum.map((e) => JSON.stringify(e)).join(", ")}` });
    }
    return issues;
  }
  if (Array.isArray(s.anyOf)) {
    const ok = (s.anyOf as unknown[]).some((sub) => structuralCheck(sub, value, path).length === 0);
    if (!ok) issues.push({ path, message: "no anyOf branch matched" });
    return issues;
  }

  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type];
    if (!types.some((t) => typeOk(t, value))) {
      issues.push({ path, message: `expected ${types.join("|")}, got ${valueType(value)}` });
      return issues;
    }
  }

  if ((type === "object" || (type === undefined && s.properties)) && isObj(value)) {
    const props = (s.properties ?? {}) as Obj;
    const required = (s.required ?? []) as string[];
    for (const req of required) {
      if (!(req in value)) issues.push({ path: joinPath(path, req), message: "required property missing" });
    }
    for (const [k, sub] of Object.entries(props)) {
      if (k in value) issues.push(...structuralCheck(sub, value[k], joinPath(path, k)));
    }
    if (s.additionalProperties === false) {
      for (const k of Object.keys(value)) {
        if (!(k in props)) issues.push({ path: joinPath(path, k), message: "unexpected property" });
      }
    }
  }
  if (type === "array" && Array.isArray(value) && s.items) {
    value.forEach((item, i) => issues.push(...structuralCheck(s.items, item, joinPath(path, String(i)))));
  }
  issues.push(...constraintCheck(s, value, path));
  return issues;
}

function typeOk(t: string, value: unknown): boolean {
  switch (t) {
    case "object":
      return isObj(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
}

function constraintCheck(s: Obj, value: unknown, path: string): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const push = (message: string) => issues.push({ path, message });
  if ("const" in s && !deepEqual(s.const, value)) push(`expected ${JSON.stringify(s.const)}`);
  if (typeof value === "string") {
    if (typeof s.minLength === "number" && value.length < s.minLength) push(`expected at least ${s.minLength} character(s)`);
    if (typeof s.maxLength === "number" && value.length > s.maxLength) push(`expected at most ${s.maxLength} character(s)`);
    if (typeof s.pattern === "string") {
      try {
        if (!new RegExp(s.pattern).test(value)) push(`does not match pattern ${s.pattern}`);
      } catch {
        // an unparseable pattern is the schema's problem, not the answer's
      }
    }
  }
  if (typeof value === "number") {
    if (typeof s.minimum === "number" && value < s.minimum) push(`expected >= ${s.minimum}`);
    if (typeof s.maximum === "number" && value > s.maximum) push(`expected <= ${s.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof s.minItems === "number" && value.length < s.minItems) push(`expected at least ${s.minItems} item(s)`);
    if (typeof s.maxItems === "number" && value.length > s.maxItems) push(`expected at most ${s.maxItems} item(s)`);
  }
  return issues;
}

function joinPath(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}

function valueType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/** Throws weft's exact answer error when `value` does not fit `schema`. */
export function assertMatches(schema: JsonSchema, value: unknown): void {
  const issues = structuralCheck(schema, value);
  if (issues.length > 0) {
    throw new WeftApiError(400, `answer does not match the request schema: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
  }
}

/** A copy of `value` with every missing property that declares a `default` filled in. */
export function applyDefaults<T = unknown>(schema: unknown, value: unknown): T {
  if (!isObj(schema)) return value as T;
  if (isObj(value) && isObj(schema.properties)) {
    const out: Obj = { ...value };
    for (const [k, sub] of Object.entries(schema.properties)) {
      if (!(k in out)) {
        if (isObj(sub) && "default" in sub) out[k] = structuredClone(sub.default);
      } else {
        out[k] = applyDefaults(sub, out[k]);
      }
    }
    return out as T;
  }
  if (Array.isArray(value) && schema.items) return value.map((item) => applyDefaults(schema.items, item)) as T;
  return value as T;
}
