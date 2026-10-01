/**
 * Source citations as po-brd and architect-aad write them: [N1 L2, R2 Acceptance Criteria],
 * [B1 §Requirements 3], [R2, R3], [A1]. Each comma-separated part starts with a source id:
 * N = PO note or request, A = added note, R = confirmed reference (dependency), B = the BRD
 * an AAD is built from, M = the shared memory. Memory has no number; today's skills cite a vault
 * note or claim by id ([M system/customer-service-v2], [M system/customer-service-v2#^c-7f3a12],
 * see memoryRef), while older documents name a section of the old single-file memory
 * ([M Document register], [R2, M Stakeholders and teams], [M]). The remark plugin turns them into
 * spans the Markdown component renders as chips; everything else in brackets stays text.
 */
import { isMemoryNoteId } from "@/lib/memory/types";

export interface CitationPart {
  /** The whole part, e.g. "R2 Acceptance Criteria". */
  raw: string;
  /** "R2" */
  source: string;
  /** "Acceptance Criteria", "L2", "§Requirements 3" */
  locator?: string;
}

const PART = /^([A-Z]{1,2}\d+(?:\s*[–-]\s*[A-Z]{0,2}\d+)?|M)(?:\s+(.+))?$/;
export const CITATION = /\[((?:[A-Z]{1,2}\d+|M(?=[\s\],;]))(?:[^[\]\n]*?))\]/g;

/**
 * The parts of a citation's inner text, or null when it is not a citation. A part that does not
 * start with a source id continues the part before it ("M Product KPIs, empty").
 */
export function parseCitation(inner: string): CitationPart[] | null {
  const parts = inner.split(/\s*[,;]\s*/).filter(Boolean);
  if (parts.length === 0) return null;
  const out: CitationPart[] = [];
  for (const raw of parts) {
    const text = raw.trim();
    const m = PART.exec(text);
    if (m?.[1]) {
      out.push({ raw: text, source: m[1], ...(m[2] ? { locator: m[2] } : {}) });
      continue;
    }
    const prev = out.at(-1);
    if (!prev || /^[A-Z]{1,2}\d/.test(text)) return null;
    // "[M system/a, system/b]": a second vault id after a memory-note part is its own M part,
    // while a legacy section keeps its comma ("[M Product KPIs, empty]").
    if (memoryRef(prev) && memoryRef({ raw: text, source: "M", locator: text })) {
      out.push({ raw: text, source: "M", locator: text });
      continue;
    }
    prev.raw = `${prev.raw}, ${text}`;
    prev.locator = prev.locator ? `${prev.locator}, ${text}` : text;
  }
  return out;
}

const SOURCE_NAMES: Record<string, string> = {
  N: "PO note",
  A: "Added note",
  R: "Reference",
  B: "BRD",
  Q: "Open question",
  S: "Source",
  M: "Memory",
  FR: "Functional requirement",
  BR: "Business requirement",
};

/** A memory citation that names a vault note, and optionally one of its claims. */
export interface MemoryRef {
  /** `system/customer-service-v2` (`org/plexus` for the root note). */
  noteId: string;
  /** Bare 6-hex block id, without the `c-` prefix (matches MemoryClaim.blockId). */
  blockId?: string;
}

/**
 * `<type>/<slug>` with an optional `#^c-xxxxxx` claim suffix (`#c-xxxxxx`, the page anchor form,
 * is accepted too). The type must be a known vault type, checked by isMemoryNoteId, so a legacy
 * section name that happens to contain a slash stays a section.
 */
const MEMORY_LOCATOR = /^([a-z]+\/[a-z0-9-]+)(?:#\^?c-([0-9a-f]{6}))?$/;

/**
 * The vault note (and claim) an `M` part cites, or null for a legacy section citation
 * ([M Document register]) and a bare [M].
 */
export function memoryRef(part: CitationPart): MemoryRef | null {
  if (part.source !== "M" || !part.locator) return null;
  const m = MEMORY_LOCATOR.exec(part.locator);
  if (!m?.[1] || !isMemoryNoteId(m[1])) return null;
  return m[2] ? { noteId: m[1], blockId: m[2] } : { noteId: m[1] };
}

/** "R2 Acceptance Criteria" -> "Reference R2, section Acceptance Criteria". */
export function describeCitationPart(part: CitationPart): string {
  const letters = /^[A-Z]+/.exec(part.source)?.[0] ?? "";
  const name = SOURCE_NAMES[letters] ?? "Source";
  if (part.source === "M") {
    // "Memory note system/x", "Memory note system/x, claim ^c-7f3a12".
    const ref = memoryRef(part);
    if (ref) return `${name} note ${ref.noteId}${ref.blockId ? `, claim ^c-${ref.blockId}` : ""}`;
    // Legacy: no number, an optional section. "Memory", "Memory, section Document register".
    return part.locator ? `${name}, section ${part.locator.replace(/^§/, "")}` : name;
  }
  if (!part.locator) return `${name} ${part.source}`;
  const line = /^L(\d+)(?:-L?(\d+))?$/.exec(part.locator);
  if (line) return `${name} ${part.source}, line ${line[1]}${line[2] ? `-${line[2]}` : ""}`;
  return `${name} ${part.source}, ${part.locator.startsWith("§") ? `section ${part.locator.slice(1)}` : part.locator}`;
}

// Minimal mdast shapes: @types/mdast is not a direct dependency.
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

const SKIP = new Set(["link", "linkReference", "inlineCode", "code", "html", "definition"]);

function splitText(value: string): MdNode[] | null {
  CITATION.lastIndex = 0;
  const out: MdNode[] = [];
  let last = 0;
  let found = false;
  for (const m of value.matchAll(CITATION)) {
    const inner = m[1] ?? "";
    if (!parseCitation(inner)) continue;
    found = true;
    const start = m.index ?? 0;
    if (start > last) out.push({ type: "text", value: value.slice(last, start) });
    out.push({
      type: "citation",
      data: { hName: "span", hProperties: { dataCitation: inner } },
      children: [{ type: "text", value: m[0] }],
    });
    last = start + m[0].length;
  }
  if (!found) return null;
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function walk(node: MdNode): void {
  if (!node.children || SKIP.has(node.type)) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      const parts = splitText(child.value);
      if (parts) next.push(...parts);
      else next.push(child);
    } else {
      walk(child);
      next.push(child);
    }
  }
  node.children = next;
}

/** remark plugin: citation text -> <span data-citation="…">[…]</span>. */
export function remarkCitations() {
  return (tree: MdNode) => walk(tree);
}
