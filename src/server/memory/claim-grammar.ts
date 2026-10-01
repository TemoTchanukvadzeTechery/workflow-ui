/**
 * The claim-line grammar of CONTRACT §2.4 and the source grammar of §2.5, ported from the CLI's
 * lib/claims.mjs. The note detail parses the retired bullets the index excludes; the timeline
 * parses claim lines out of git diffs. Pure: no fs, no spawn.
 */
import type { MemoryRetiredClaim, MemorySource } from "@/lib/memory/types";

const BLOCK_ID_RE = /^\^c-([0-9a-f]{6})$/;
const RETIRED_RE = /^(.*?)\s*\(retired:\s*(.*)\)$/;
const DOCUMENT_RE = /^\[\[documents?\/([a-z0-9-]+)\]\]$/;
const JIRA_RE = /^[A-Z][A-Z0-9]+-\d+$/;
const CONFLUENCE_RE = /^confluence:(\d+)$/;
const CODE_RE = /^bitbucket\.org\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/[^\s@]*)?(@[A-Za-z0-9._-]+)?$/;

export function parseSourceToken(token: string): MemorySource | null {
  const doc = DOCUMENT_RE.exec(token);
  if (doc) return { kind: "document", ref: doc[1] };
  if (JIRA_RE.test(token)) return { kind: "jira", ref: token };
  const page = CONFLUENCE_RE.exec(token);
  if (page) return { kind: "confluence", ref: page[1] };
  if (CODE_RE.test(token)) return { kind: "code", ref: token };
  return null;
}

/** The trailing run of tokens that are only sources, `§section` text and `(proposed)`. */
export function parseTrailingRun(tokens: string[]): { sources: MemorySource[]; proposed: boolean } | null {
  const sources: MemorySource[] = [];
  let proposed = false;
  let sectionWords: string[] | null = null;
  for (const token of tokens) {
    const source = parseSourceToken(token);
    if (source) {
      sources.push(source);
      sectionWords = null;
      continue;
    }
    if (token === "(proposed)") {
      proposed = true;
      sectionWords = null;
      continue;
    }
    const last = sources[sources.length - 1];
    if (token.startsWith("§") && last?.kind === "document" && last.section === undefined) {
      sectionWords = [];
      const rest = token.slice(1);
      if (rest !== "") sectionWords.push(rest);
      last.section = sectionWords.join(" ");
      continue;
    }
    if (sectionWords === null) return null;
    sectionWords.push(token);
    last.section = sectionWords.join(" ");
  }
  return { sources, proposed };
}

export function parseSources(text: string): { sources: MemorySource[]; rest: string; proposed: boolean } {
  const tokens = text.trim().split(/\s+/).filter((t) => t !== "");
  for (let i = 0; i < tokens.length; i += 1) {
    if (!parseSourceToken(tokens[i])) continue;
    const run = parseTrailingRun(tokens.slice(i));
    if (!run) continue;
    const restTokens = tokens.slice(0, i);
    if (restTokens[restTokens.length - 1] === "(proposed)") return { sources: run.sources, rest: restTokens.slice(0, -1).join(" "), proposed: true };
    return { sources: run.sources, rest: restTokens.join(" "), proposed: run.proposed };
  }
  if (tokens[tokens.length - 1] === "(proposed)") return { sources: [], rest: tokens.slice(0, -1).join(" "), proposed: true };
  return { sources: [], rest: tokens.join(" "), proposed: false };
}

/** One claim bullet, as the CLI's parseClaim reads it (without `raw`). */
export interface ParsedClaimBullet {
  /** Bare 6-hex id, or null when the bullet lacks a trailing `^c-xxxxxx`. */
  blockId: string | null;
  text: string;
  proposed: boolean;
  /** The `(retired: <reason>)` reason; null when the bullet has no marker. */
  retired: string | null;
  sources: MemorySource[];
}

/**
 * Parse one `- <text> [(proposed)] <source>… [(retired: …)] ^c-<id>` line (CONTRACT §2.4).
 * Null when the line is not a `- ` bullet. Leading `+`/`-` diff markers must be stripped first.
 */
export function parseClaimBullet(line: string): ParsedClaimBullet | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("- ")) return null;
  let content = trimmed.slice(2).trim();
  let blockId: string | null = null;
  const tokens = content.split(/\s+/);
  const idMatch = BLOCK_ID_RE.exec(tokens[tokens.length - 1]);
  if (idMatch) {
    blockId = idMatch[1];
    content = tokens.slice(0, -1).join(" ");
  }
  let retired: string | null = null;
  const retiredMatch = RETIRED_RE.exec(content);
  if (retiredMatch) {
    retired = retiredMatch[2].trim();
    content = retiredMatch[1];
  }
  const { sources, rest, proposed } = parseSources(content);
  return { blockId, text: rest.trim(), proposed, retired, sources };
}

/** A bullet under `## Retired claims`; `retired` is "" when the marker is missing. */
export function parseRetiredBullet(line: string): MemoryRetiredClaim | null {
  const bullet = parseClaimBullet(line);
  if (!bullet) return null;
  return { blockId: bullet.blockId, text: bullet.text, proposed: bullet.proposed, sources: bullet.sources, retired: bullet.retired ?? "" };
}
