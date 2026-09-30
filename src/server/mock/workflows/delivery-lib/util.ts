import "server-only";
/**
 * Small deterministic helpers for the Stage 3-4 mock scripts. Everything the scripts produce is a
 * pure function of the run input, so re-running a seed yields the same content.
 */

/** FNV-1a 32-bit: stable across runs and platforms. */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic pick from a list, keyed by a string. */
export function pick<T>(items: readonly T[], key: string): T {
  return items[hashString(key) % items.length];
}

/** Deterministic integer in [min, max], keyed by a string. */
export function between(min: number, max: number, key: string): number {
  return min + (hashString(key) % (max - min + 1));
}

export function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

const STOPWORDS = new Set([
  "a", "an", "and", "the", "of", "for", "per", "on", "by", "to", "with", "in", "at", "from", "into", "behind", "is", "are",
  "be", "or", "as", "its", "their", "this", "that", "it", "when", "only", "not", "no", "all", "can", "via",
]);
const VERBS = new Set([
  "add", "adds", "publish", "create", "implement", "implementation", "record", "show", "build", "support", "expose",
  "handle", "update", "new", "track", "wire", "enable", "e2e", "qa", "endpoint", "route",
]);

export function words(value: string): string[] {
  return value
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[`"'()]/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/** "Aggregate coverage query per CustomerAgreementTypeID" -> ["Aggregate", "coverage", ...] minus filler. */
export function significantWords(value: string): string[] {
  return words(value).filter((w) => !STOPWORDS.has(w.toLowerCase()));
}

function capitalize(w: string): string {
  if (/^[A-Z0-9]+$/.test(w) && w.length <= 4) return w[0] + w.slice(1).toLowerCase();
  return w[0].toUpperCase() + w.slice(1);
}

export function pascalCase(value: string, maxWords = 3): string {
  return significantWords(value)
    .slice(0, maxWords)
    .map(capitalize)
    .join("");
}

export function camelCase(value: string, maxWords = 6): string {
  const p = significantWords(value).slice(0, maxWords).map(capitalize).join("");
  return p ? p[0].toLowerCase() + p.slice(1) : "";
}

export function kebabCase(value: string, maxWords = 4): string {
  return significantWords(value)
    .slice(0, maxWords)
    .map((w) => w.toLowerCase())
    .join("-");
}

/** Class-name style feature noun from a task title: drops filler words and leading verbs. */
export function featureName(title: string, maxWords = 2): string {
  const sig = significantWords(title).filter((w) => !VERBS.has(w.toLowerCase()));
  const chosen = sig.length ? sig : significantWords(title);
  return chosen.slice(0, maxWords).map(capitalize).join("") || "Feature";
}

/** Words that keep their capital mid-sentence (people, teams, products, customer types). */
const PROPER = new Set(["Legal", "Legal/Compliance", "Brand", "Preferred", "Retail", "Customer", "Support", "Okta", "Auth0", "Contentful", "LaunchDarkly", "Kafka", "Spanish", "English", "Ambassadors", "Ambassador"]);

/** Lower-cases a sentence's first letter to embed it mid-sentence, keeping acronyms and proper nouns. */
export function lowerFirst(s: string): string {
  const first = s.split(/\s/)[0] ?? "";
  if (!first || PROPER.has(first.replace(/[,.;:]$/, "")) || /^[A-Z0-9]{2,}/.test(first)) return s;
  return s[0].toLowerCase() + s.slice(1);
}

export function stripScope(title: string): string {
  return title.replace(/^\s*\[[^\]]+\]\s*/, "").trim();
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function uniq<T>(items: Iterable<T>): T[] {
  return [...new Set(items)];
}

/** "- a\n- b" or "- none" (the po-brd report convention for empty sections). */
export function bullets(items: readonly string[]): string {
  return items.length ? items.map((i) => `- ${i}`).join("\n") : "- none";
}

/** Escapes a value for a markdown table cell. */
export function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Compares "T-2" < "T-10" numerically. */
export function compareTaskIds(a: string, b: string): number {
  const na = Number(a.match(/(\d+)$/)?.[1] ?? NaN);
  const nb = Number(b.match(/(\d+)$/)?.[1] ?? NaN);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

/** Short hex id derived from a key, e.g. a fake commit sha for a branch. */
export function shortSha(key: string, length = 7): string {
  let out = "";
  let seed = key;
  while (out.length < length) {
    seed = `${seed}#`;
    out += hashString(seed).toString(16).padStart(8, "0");
  }
  return out.slice(0, length);
}

/** Truncates at a word boundary. */
export function clip(value: string, max: number): string {
  const s = value.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

export function mmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
