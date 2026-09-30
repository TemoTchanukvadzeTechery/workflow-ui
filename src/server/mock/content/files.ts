import "server-only";
/**
 * Raw content lives in src/server/mock/content/files/ as .md and .json so long markdown needs no
 * template-literal escaping. Read once per process and cached.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const cache = new Map<string, string>();

export function contentFile(name: string): string {
  let text = cache.get(name);
  if (text === undefined) {
    text = readFileSync(path.join(process.cwd(), "src/server/mock/content/files", name), "utf8");
    cache.set(name, text);
  }
  return text;
}

export function contentJson<T>(name: string): T {
  return JSON.parse(contentFile(name)) as T;
}
