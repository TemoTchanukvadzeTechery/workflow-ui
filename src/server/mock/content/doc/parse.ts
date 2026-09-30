import "server-only";
/**
 * Markdown helpers for BRD and AAD files: section lookup and replacement, and the parse
 * contract of SPEC 4.2a (numbered BRD requirements, the AAD Functional Requirements table and
 * the High-Level Architecture system change table). Used by the generic generator, the reviser,
 * the memory proposer and the self-test; tolerant of documents a human edited or imported.
 */

export interface BrdRequirementRow {
  n: number;
  text: string;
  candidate: boolean;
}

export interface FrRow {
  id: string;
  text: string;
  traces: number[];
  design: string;
}

export interface SystemRow {
  system: string;
  status: string;
  change: string;
}

export interface QuestionRow {
  id: string;
  text: string;
  who: string;
}

function lines(md: string): string[] {
  return md.replace(/\r\n/g, "\n").split("\n");
}

/** Title from the first H1, without the "BRD: " or "Architecture Approach - " prefix. */
export function docTitle(md: string): string {
  const h1 = lines(md).find((l) => /^#\s+/.test(l));
  if (!h1) return "";
  return h1
    .replace(/^#\s+/, "")
    .replace(/^BRD:\s*/i, "")
    .replace(/^Architecture Approach\s*[-–—:]\s*/i, "")
    .trim();
}

interface Range {
  start: number;
  end: number;
}

/** Line range of the body under a heading of `level`, up to the next heading of the same or higher level. */
function range(all: string[], heading: string, level: number): Range | undefined {
  const want = heading.toLowerCase();
  const idx = all.findIndex((l) => {
    const m = /^(#{1,6})\s+(.*)$/.exec(l);
    return !!m && m[1]?.length === level && (m[2] ?? "").trim().toLowerCase() === want;
  });
  if (idx < 0) return undefined;
  let end = all.length;
  for (let i = idx + 1; i < all.length; i++) {
    const m = /^(#{1,6})\s/.exec(all[i] ?? "");
    if (m && (m[1]?.length ?? 7) <= level) {
      end = i;
      break;
    }
  }
  return { start: idx + 1, end };
}

export function sectionBody(md: string, heading: string, level = 2): string | undefined {
  const all = lines(md);
  const r = range(all, heading, level);
  return r ? all.slice(r.start, r.end).join("\n").trim() : undefined;
}

export function hasSection(md: string, heading: string, level = 2): boolean {
  return range(lines(md), heading, level) !== undefined;
}

/** Replaces the body of a section; appends the section at the end when it is missing. */
export function replaceSectionBody(md: string, heading: string, body: string, level = 2): string {
  const all = lines(md);
  const r = range(all, heading, level);
  if (!r) return `${md.replace(/\s+$/, "")}\n\n${"#".repeat(level)} ${heading}\n\n${body.trim()}\n`;
  const after = all.slice(r.end);
  return [...all.slice(0, r.start), "", body.trim(), ...(after.length > 0 ? ["", ...after] : [""])].join("\n");
}

/**
 * Inserts text at the end of a section's own content, before its first subsection, so an
 * appended paragraph stays with the section it belongs to.
 */
export function appendToSection(md: string, heading: string, text: string, level = 2): string {
  const all = lines(md);
  const r = range(all, heading, level);
  if (!r) return replaceSectionBody(md, heading, text, level);
  let end = r.end;
  for (let i = r.start; i < r.end; i++) {
    if (/^#{1,6}\s/.test(all[i] ?? "")) {
      end = i;
      break;
    }
  }
  let tail = end;
  while (end > r.start && (all[end - 1] ?? "").trim() === "") end--;
  while (tail < all.length && (all[tail] ?? "").trim() === "") tail++;
  const rest = all.slice(tail);
  return [...all.slice(0, end), "", text.trim(), ...(rest.length > 0 ? ["", ...rest] : [""])].join("\n");
}

/** Top-level (##) section headings in order. */
export function sectionHeadings(md: string, level = 2): string[] {
  const prefix = `${"#".repeat(level)} `;
  return lines(md)
    .filter((l) => l.startsWith(prefix) && !l.startsWith(`${prefix}#`))
    .map((l) => l.slice(prefix.length).trim());
}

/** Numbered items of the BRD Requirements section (BR-n = item n). */
export function brdRequirements(md: string): BrdRequirementRow[] {
  const body = sectionBody(md, "Requirements") ?? "";
  const out: BrdRequirementRow[] = [];
  for (const line of body.split("\n")) {
    const m = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (m) {
      const text = (m[2] ?? "").trim();
      // A struck item ("~~text~~ Moved to Out of Scope …") is no longer a requirement.
      if (text.startsWith("~~")) continue;
      out.push({ n: Number(m[1]), text, candidate: /\(Candidate\)/i.test(text) });
    } else if (out.length > 0 && /^\s{2,}\S/.test(line)) {
      const last = out[out.length - 1]!;
      last.text = `${last.text} ${line.trim()}`;
    }
  }
  return out;
}

/** Table rows as trimmed cells, skipping the header separator. */
export function tableRows(body: string): string[][] {
  return body
    .split("\n")
    .filter((l) => /^\s*\|/.test(l))
    .map((l) => splitCells(l.trim().replace(/^\|/, "").replace(/\|$/, "")))
    .filter((cells) => !cells.every((c) => /^:?-{3,}:?$/.test(c)));
}

/** Splits a table row on unescaped pipes. */
function splitCells(row: string): string[] {
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === "\\" && row[i + 1] === "|") {
      cur += "\\|";
      i++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

/** FR rows of the AAD Functional Requirements table, with the BRD numbers they trace to. */
export function aadFrs(md: string): FrRow[] {
  const body = sectionBody(md, "Functional Requirements", 3) ?? "";
  return tableRows(body)
    .filter((c) => /^FR\d+$/i.test(c[0] ?? ""))
    .map((c) => ({
      id: (c[0] ?? "").toUpperCase(),
      text: c[1] ?? "",
      traces: Array.from((c[2] ?? "").matchAll(/§Requirements\s+(\d+)/g)).map((m) => Number(m[1])),
      design: c[3] ?? "",
    }));
}

/**
 * Rows of the system change table under High-Level Architecture. Accepts the 3-column form
 * (| System | Change type | Change |) and the 2-column form of the real aad.md, where the
 * change starts with a bold status such as "**Proposed.**".
 */
export function systemChanges(md: string): SystemRow[] {
  const body = sectionBody(md, "High-Level Architecture", 3) ?? "";
  const rows = tableRows(body);
  const out: SystemRow[] = [];
  for (const c of rows) {
    const system = (c[0] ?? "").replace(/\*\*/g, "");
    if (!system || /^system$/i.test(system)) continue;
    if (c.length >= 3) {
      out.push({ system, status: (c[1] ?? "").replace(/\*\*/g, "").replace(/\.$/, ""), change: c[2] ?? "" });
    } else {
      const m = /^\*\*([^*]+)\*\*\s*(.*)$/.exec(c[1] ?? "");
      out.push({ system, status: (m?.[1] ?? "").replace(/\.$/, "").trim(), change: (m?.[2] ?? c[1] ?? "").trim() });
    }
  }
  return out;
}

/** Q<n> rows from an Open Questions table (BRD) or the AAD appendix. */
export function openQuestions(md: string): QuestionRow[] {
  const body = sectionBody(md, "Open Questions") ?? sectionBody(md, "Appendix: Open Questions") ?? "";
  const fromTable = tableRows(body)
    .filter((c) => /^Q\d+$/.test(c[0] ?? ""))
    .map((c) => ({ id: c[0] ?? "", text: c[1] ?? "", who: c[2] ?? "" }));
  if (fromTable.length > 0) return fromTable;
  return body
    .split("\n")
    .map((l) => /^\s*[-*]?\s*(Q\d+)\s*[:.—-]\s*(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ id: m[1] ?? "", text: (m[2] ?? "").trim(), who: "" }));
}

/** Rows of the Sources table (BRD "Sources", AAD "Appendix: Sources"). */
export function sourceRows(md: string): string[][] {
  const body = sectionBody(md, "Sources") ?? sectionBody(md, "Appendix: Sources") ?? "";
  return tableRows(body).filter((c) => (c[0] ?? "") !== "ID");
}

/** Numbered list items of a section body. */
export function numberedItems(body: string): string[] {
  return body
    .split("\n")
    .map((l) => /^\s*\d+\.\s+(.*)$/.exec(l)?.[1]?.trim())
    .filter((t): t is string => !!t);
}

/** Bullet items of a section body. */
export function bulletItems(body: string): string[] {
  return body
    .split("\n")
    .map((l) => /^\s*[-*]\s+(.*)$/.exec(l)?.[1]?.trim())
    .filter((t): t is string => !!t);
}

/** Strips bracketed citations such as [N1 L2, R2 Acceptance Criteria]. */
export function stripCites(text: string): string {
  return text
    .replace(/\s*\[[^\]]*\b(?:[NRABM]\d*|B1|PO feedback|architect feedback)[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
