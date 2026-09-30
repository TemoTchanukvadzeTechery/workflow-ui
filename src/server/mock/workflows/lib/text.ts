import "server-only";
/**
 * Pure text helpers ported from po-workspace/.weft/workflows/po-brd/lib/index.ts and
 * lib/discovery.ts, plus small utilities the mock scripts and content packs share.
 */
import { createHash } from "node:crypto";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The PO's initial source entries: request text first, then note files or inline note text. */
export function noteEntries(request: string, notes: readonly string[]): string[] {
  return [...(request.trim() ? [request] : []), ...notes];
}

/**
 * Jira keys and Confluence page ids mentioned in text: browse URLs, page URLs, and bare keys
 * such as CP-50908. Same patterns as the real extractRefs, so seeds match weft's.
 */
export function extractRefs(text: string): string[] {
  const refs = [
    ...Array.from(text.matchAll(/\b([A-Z][A-Z0-9]+-\d+)\b/g)).map((m) => m[1] ?? ""),
    ...Array.from(text.matchAll(/\/pages\/(?:[^\s/]+\/)*?(\d{5,})\b/g)).map((m) => m[1] ?? ""),
    ...Array.from(text.matchAll(/[?&]pageId=(\d+)/g)).map((m) => m[1] ?? ""),
  ];
  return [...new Set(refs.filter((ref) => ref !== ""))];
}

/** A single line without spaces, the only shape a repository-relative note path takes. */
export function looksLikePath(entry: string): boolean {
  const t = entry.trim();
  return t !== "" && !/\s/.test(t) && !/^https?:/i.test(t);
}

/** Renders one source as a tagged block with numbered lines so citations like [N1 L5] resolve. */
export function sourceBlock(id: string, path: string, content: string, type = "PO notes"): string {
  const numbered = content
    .split("\n")
    .map((line, i) => `L${i + 1}: ${line}`)
    .join("\n");
  return `<source id="${id}" type="${type}" path="${path}">\n${numbered}\n</source>`;
}

/** A Markdown list for review attachments; "none" keeps empty sections explicit (main.ts section()). */
export function section(title: string, items: readonly string[]): string {
  return `## ${title}\n\n${items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none"}`;
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[... truncated ${text.length - max} characters]`;
}

export function titleCase(slug: string): string {
  const small = new Set(["and", "or", "of", "the", "a", "an", "to", "for", "in", "on", "at", "by"]);
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Lines of a note with their 1-based numbers, skipping blanks. */
export function numberedLines(content: string): Array<{ n: number; text: string }> {
  return content
    .split("\n")
    .map((text, i) => ({ n: i + 1, text: text.trim() }))
    .filter((l) => l.text !== "");
}

/** Splits free text into sentences (keeps list items as their own sentences). */
export function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .flatMap((line) => line.replace(/([.!?])\s+(?=[A-Z0-9"'(])/g, "$1\u0000").split("\u0000"))
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

const STOPWORDS = new Set(
  (
    "a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just like me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours need needs want wants make sure able get got going use used using already existing currently today maybe also etc per via one two three new ones thing things something someone people currently place see seeing just overall like"
  ).split(/\s+/),
);

/** Significant lowercase words of a text, most frequent first. */
export function keywords(text: string, max = 6): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []) {
    const w = raw.replace(/-+$/, "");
    if (w.length < 4 || STOPWORDS.has(w) || /^[a-z]+-\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}

export function isStopword(word: string): boolean {
  return STOPWORDS.has(word.toLowerCase());
}

/** A stable small integer from a string, for deterministic variety in generated content. */
export function hashInt(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Escapes a value for a Markdown table cell. */
export function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
