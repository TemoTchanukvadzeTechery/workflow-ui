import "server-only";
/**
 * Parsers for the document formats of SPEC 4.2a: BRD requirements (BR-n, incl. candidates), open
 * questions (Q-n), the AAD functional-requirement table (FRn with BRD traces) and the AAD system
 * change table. Tolerant by design: agent output drifts, so every parser accepts a few shapes
 * and returns empty lists rather than throwing.
 */
import type { AadRequirement, BrdRequirement, DraftReport, AadReport } from "@/lib/delivery/types";

export interface OpenQuestion {
  id: string;
  text: string;
  owner?: string;
}

export interface SystemChange {
  system: string;
  /** "Proposed", "No change proposed", "Explicitly not used", … */
  status: string;
  change: string;
  /** false for "No change" / "not used" rows. */
  changed: boolean;
}

export interface ParsedBrd {
  title?: string;
  requirements: BrdRequirement[];
  openQuestions: OpenQuestion[];
  /** Implementation Plan checklist items (comms, help center, training…), status suffix removed. */
  implementationPlan: string[];
}

export interface ParsedAad {
  title?: string;
  frs: AadRequirement[];
  systems: SystemChange[];
  openQuestions: OpenQuestion[];
}

interface Section {
  level: number;
  title: string;
  body: string;
}

/** Split markdown into heading sections, ignoring "#" lines inside fenced code blocks. */
export function splitSections(md: string): Section[] {
  const out: Section[] = [];
  let current: { level: number; title: string; lines: string[] } | null = null;
  let fence = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = !fence ? line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/) : null;
    if (m) {
      if (current) out.push({ level: current.level, title: current.title, body: current.lines.join("\n") });
      current = { level: m[1].length, title: m[2], lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) out.push({ level: current.level, title: current.title, body: current.lines.join("\n") });
  return out;
}

/** Body of the first section whose title matches, including its sub-sections. */
export function sectionBody(md: string, match: RegExp): string | undefined {
  const sections = splitSections(md);
  const i = sections.findIndex((s) => match.test(s.title.trim()));
  if (i < 0) return undefined;
  const { level } = sections[i];
  const parts = [sections[i].body];
  for (let j = i + 1; j < sections.length && sections[j].level > level; j++) {
    parts.push(`${"#".repeat(sections[j].level)} ${sections[j].title}\n${sections[j].body}`);
  }
  return parts.join("\n");
}

/** Remove source citations such as "[N1 L2, R2 Acceptance Criteria]" but keep markdown links. */
export function stripCitations(text: string): string {
  return text
    .replace(/\s*\[(?:[A-Z]{1,2}\d{0,3}\b)[^\]]*\](?!\()/g, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Plain text of a markdown cell: links become their label, emphasis and code ticks go. */
export function plainText(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Rows of every markdown table in `body`, header and separator rows included (caller filters). */
export function tableRows(body: string): string[][] {
  const rows: string[][] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.replace(/\\\|/g, "|").trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    rows.push(cells);
  }
  return rows;
}

function questionsFrom(body: string | undefined): OpenQuestion[] {
  if (!body) return [];
  const out = new Map<string, OpenQuestion>();
  for (const row of tableRows(body)) {
    const id = plainText(row[0] ?? "").match(/^Q\s*(\d+)$/i);
    if (id && row[1]) out.set(`Q${id[1]}`, { id: `Q${id[1]}`, text: stripCitations(plainText(row[1])), owner: row[2] ? plainText(row[2]) : undefined });
  }
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:[-*]|\d+[.)])\s+(?:\*\*)?(Q\s*\d+)(?:\*\*)?\s*[—–:.)-]?\s*(.+)$/);
    if (m) {
      const id = m[1].replace(/\s+/g, "");
      if (!out.has(id)) out.set(id, { id, text: stripCitations(plainText(m[2])) });
    }
  }
  return [...out.values()].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

/** Numbered list items of a section; indented continuation lines join the item. */
function numberedItems(body: string): Array<{ n: number; text: string }> {
  const items: Array<{ n: number; text: string }> = [];
  let current: { n: number; text: string } | null = null;
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s{0,3}(\d+)[.)]\s+(.*)$/);
    if (m) {
      if (current) items.push(current);
      current = { n: Number(m[1]), text: m[2].trim() };
    } else if (current && /^\s+\S/.test(line)) {
      current.text += ` ${line.trim()}`;
    } else if (current) {
      items.push(current);
      current = null;
    }
  }
  if (current) items.push(current);
  return items;
}

export function parseBrd(md: string): ParsedBrd {
  const title = md.match(/^#\s+BRD:\s*(.+?)\s*$/m)?.[1] ?? md.match(/^#\s+(.+?)\s*$/m)?.[1];
  const reqBody = sectionBody(md, /^requirements$/i) ?? "";
  const requirements: BrdRequirement[] = [];
  const seen = new Set<string>();
  for (const item of numberedItems(reqBody)) {
    const id = `BR-${item.n}`;
    if (seen.has(id)) continue;
    seen.add(id);
    // "3. ~~text~~ Moved to Out of Scope in round 2": struck at review, no longer a requirement.
    if (/^~~/.test(item.text)) continue;
    const candidate = /\(candidate\)/i.test(item.text);
    const text = stripCitations(plainText(item.text.replace(/\(candidate\)\s*/i, "")));
    requirements.push(candidate ? { id, text, candidate } : { id, text });
  }
  // Fallback shape some drafts use: "- BR-3: text".
  if (!requirements.length) {
    for (const line of reqBody.split(/\r?\n/)) {
      const m = line.match(/^\s*[-*]\s+(?:\*\*)?BR-(\d+)(?:\*\*)?[:.\s–—-]+(.*)$/);
      if (!m) continue;
      const candidate = /\(candidate\)/i.test(m[2]);
      const text = stripCitations(plainText(m[2].replace(/\(candidate\)\s*/i, "")));
      requirements.push(candidate ? { id: `BR-${m[1]}`, text, candidate } : { id: `BR-${m[1]}`, text });
    }
  }
  const planBody = sectionBody(md, /^implementation plan$/i) ?? "";
  const implementationPlan = numberedItems(planBody)
    .map((i) => plainText(i.text).replace(/\s+[—–-]\s+(not yet provided|not started|done|in progress|tbd).*$/i, "").replace(/[.:]\s*$/, ""))
    .filter(Boolean);
  return {
    title: title?.trim(),
    requirements,
    openQuestions: questionsFrom(sectionBody(md, /open questions/i)),
    implementationPlan,
  };
}

const NO_CHANGE = /^(no change|unchanged|explicitly not used|not used|none|n\/a)/i;

function parseSystemTable(body: string | undefined): SystemChange[] {
  if (!body) return [];
  const out: SystemChange[] = [];
  let inSystemTable = false;
  let columns = 2;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("|")) {
      inSystemTable = false;
      continue;
    }
    const [row] = tableRows(line);
    if (!row) continue;
    if (/^system$/i.test(plainText(row[0] ?? ""))) {
      inSystemTable = true;
      columns = row.length;
      continue;
    }
    if (!inSystemTable || !row[0]) continue;
    const system = plainText(row[0]);
    let status: string;
    let change: string;
    if (columns >= 3 && row.length >= 3) {
      status = plainText(row[1]);
      change = plainText(row.slice(2).join(" "));
    } else {
      const cell = row[1] ?? "";
      const bold = cell.match(/^\s*\*\*(.+?)\*\*\s*(.*)$/);
      status = plainText(bold ? bold[1] : cell.split(/[.;]/)[0] ?? "");
      change = plainText(bold ? bold[2] : cell);
    }
    status = status.replace(/[.:]\s*$/, "");
    out.push({ system, status, change: stripCitations(change), changed: !NO_CHANGE.test(status) });
  }
  return out;
}

export function parseAad(md: string): ParsedAad {
  const title =
    md.match(/^#\s+Architecture Approach\s*[-–—:]\s*(.+?)\s*$/m)?.[1] ?? md.match(/^#\s+AAD:\s*(.+?)\s*$/m)?.[1] ?? md.match(/^#\s+(.+?)\s*$/m)?.[1];
  const frBody = sectionBody(md, /^functional requirements$/i) ?? sectionBody(md, /^requirement details$/i) ?? "";
  const frs: AadRequirement[] = [];
  for (const row of tableRows(frBody)) {
    const id = plainText(row[0] ?? "").match(/^FR\s*(\d+)$/i);
    if (!id) continue;
    const traceCell = row[2] ?? "";
    const traces = [...traceCell.matchAll(/§\s*Requirements?\s+(\d+)/gi)].map((m) => `BR-${m[1]}`);
    if (!traces.length) for (const m of traceCell.matchAll(/\bBR-?(\d+)\b/gi)) traces.push(`BR-${m[1]}`);
    const text = stripCitations(plainText((row[1] ?? "").replace(/^\s*\*\(([^)]*)\)\*\s*/, "")));
    const designElement = row[3] ? stripCitations(plainText(row[3])) : undefined;
    frs.push({ id: `FR${id[1]}`, text, traces: [...new Set(traces)], designElement: designElement || undefined });
  }
  return {
    title: title?.trim(),
    frs,
    systems: parseSystemTable(sectionBody(md, /^high-level architecture$/i) ?? sectionBody(md, /system changes?/i)),
    openQuestions: questionsFrom(sectionBody(md, /open questions/i)),
  };
}

const REPORT_SECTIONS: Array<[RegExp, keyof AadReport]> = [
  [/^blocking questions/i, "blockingQuestions"],
  [/^decisions needed/i, "decisionsNeeded"],
  [/requirements not traced/i, "untracedRequirements"],
  [/^conflicts/i, "conflicts"],
  [/not yet provided/i, "missingSections"],
  [/^instructions/i, "ignoredInstructions"],
  [/^changes in this round/i, "changes"],
];

/** Parse a "draft report" attachment (## sections of "- item", "- none" = empty) into a report. */
export function parseDraftReport(md: string, path: string): DraftReport | AadReport {
  const report: AadReport = {
    path,
    missingSections: [],
    blockingQuestions: [],
    conflicts: [],
    ignoredInstructions: [],
    changes: [],
    untracedRequirements: [],
    decisionsNeeded: [],
  };
  let isAad = false;
  for (const s of splitSections(md)) {
    const hit = REPORT_SECTIONS.find(([re]) => re.test(s.title.trim()));
    if (!hit) continue;
    if (hit[1] === "decisionsNeeded" || hit[1] === "untracedRequirements") isAad = true;
    const items = s.body
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*[-*]\s+(.*)$/)?.[1]?.trim())
      .filter((l): l is string => !!l && !/^none\.?$/i.test(l));
    (report[hit[1]] as string[]).push(...items);
  }
  if (isAad) return report;
  const { untracedRequirements: _u, decisionsNeeded: _d, ...brd } = report;
  void _u;
  void _d;
  return brd;
}

/** Q-ids mentioned in a text, e.g. "see Q3" → ["Q3"]. */
export function questionRefs(text: string): string[] {
  return [...new Set([...text.matchAll(/\bQ(\d+)\b/g)].map((m) => `Q${m[1]}`))];
}
