/**
 * remark plugin (plan A4): Obsidian wikilinks in memory-note prose — [[target]], [[target|alias]],
 * [[target#Heading]], [[target#^c-xxxxxx]] — rewritten with the server's resolution map
 * (MemoryNoteDetailPayload.resolvedLinks, keyed by the target with |alias and #… stripped).
 * Resolved targets become /memory/<id> links (a claim anchor #^c-x becomes #c-x, a heading becomes
 * its rehype-slug id); unresolved ones become a muted dashed chip span with a title tooltip.
 * Mirrors docs/citations.ts: same minimal mdast walking, handed to Markdown via `remarkPlugins`.
 */
import type { MemoryResolvedLink } from "@/lib/memory/types";

export interface WikilinkOptions {
  /** MemoryNoteDetailPayload.resolvedLinks: bare target → note (or null when unresolved). */
  links: Record<string, MemoryResolvedLink | null>;
}

// Minimal mdast shapes: @types/mdast is not a direct dependency (matches citations.ts).
interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

const WIKILINK = /\[\[([^[\]]+)\]\]/g;
const BLOCK_REF = /^\^c-([0-9a-f]{6})$/;
const SKIP = new Set(["link", "linkReference", "inlineCode", "code", "html", "definition"]);

/** The muted dashed chip an unresolved wikilink renders as (Markdown's span component passes className through). */
const UNRESOLVED_CLASS =
  "inline-flex max-w-full items-baseline rounded-full border border-dashed border-circle-border px-1.5 align-baseline text-[0.92em] whitespace-nowrap text-muted-foreground";

/** github-slugger's core rules (what rehype-slug uses), close enough for `[[note#Heading]]` anchors. */
function headingSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

export interface ParsedWikilink {
  /** The bare target, without `|alias` and `#…` (the resolvedLinks key). */
  target: string;
  /** The text after `#`: a heading, or a `^c-xxxxxx` block ref. "" when absent. */
  suffix: string;
  /** The `|alias` display text. "" when absent. */
  alias: string;
}

/** Split a wikilink's inner text (`documents/brd-x#Goals|the BRD`) into target / suffix / alias. */
export function parseWikilink(inner: string): ParsedWikilink {
  const pipe = inner.indexOf("|");
  const targetPart = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
  const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : "";
  const hash = targetPart.indexOf("#");
  const target = (hash >= 0 ? targetPart.slice(0, hash) : targetPart).trim();
  const suffix = hash >= 0 ? targetPart.slice(hash + 1).trim() : "";
  return { target, suffix, alias };
}

function wikilinkNode(inner: string, links: WikilinkOptions["links"]): MdNode {
  const { target, suffix, alias } = parseWikilink(inner);
  const resolved = links[target] ?? null;
  if (resolved) {
    const block = BLOCK_REF.exec(suffix);
    const anchor = block ? `#c-${block[1]}` : suffix !== "" ? `#${headingSlug(suffix)}` : "";
    const text = alias || (block ? `${resolved.title} ^c-${block[1]}` : suffix !== "" ? `${resolved.title} § ${suffix}` : resolved.title);
    return { type: "link", url: `/memory/${resolved.id}${anchor}`, children: [{ type: "text", value: text }] };
  }
  const written = suffix !== "" ? `${target}#${suffix}` : target;
  return {
    type: "wikilink",
    data: {
      hName: "span",
      hProperties: { className: UNRESOLVED_CLASS, title: `Link does not resolve: no note matches [[${written}]]` },
    },
    children: [{ type: "text", value: alias || written }],
  };
}

function splitText(value: string, links: WikilinkOptions["links"]): MdNode[] | null {
  WIKILINK.lastIndex = 0;
  const out: MdNode[] = [];
  let last = 0;
  let found = false;
  for (const m of value.matchAll(WIKILINK)) {
    const inner = (m[1] ?? "").trim();
    if (inner === "") continue;
    found = true;
    const start = m.index ?? 0;
    if (start > last) out.push({ type: "text", value: value.slice(last, start) });
    out.push(wikilinkNode(inner, links));
    last = start + m[0].length;
  }
  if (!found) return null;
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function walk(node: MdNode, links: WikilinkOptions["links"]): void {
  if (!node.children || SKIP.has(node.type)) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      const parts = splitText(child.value, links);
      if (parts) next.push(...parts);
      else next.push(child);
    } else {
      walk(child, links);
      next.push(child);
    }
  }
  node.children = next;
}

/** remark plugin factory: pass as `[remarkWikilinks, { links: detail.resolvedLinks }]`. */
export function remarkWikilinks(options: WikilinkOptions) {
  return (tree: MdNode) => walk(tree, options.links);
}
