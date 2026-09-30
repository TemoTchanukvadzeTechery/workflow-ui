/**
 * Jira keys and Confluence page ids, as po-brd understands them. extractRefs is a port of
 * po-workspace/.weft/workflows/po-brd/lib/index.ts so the "Detected" chips under the request
 * textarea show exactly what the workflow will pick up. Isomorphic and pure.
 */

const JIRA_KEY = /^[A-Z][A-Z0-9]+-\d+$/;
const JIRA_BROWSE = /\/browse\/([A-Z][A-Z0-9]+-\d+)\b/i;
const CONFLUENCE_PAGES = /\/pages\/(?:[^\s/]+\/)*?(\d{5,})\b/;
const CONFLUENCE_PAGE_ID = /[?&]pageId=(\d+)/;

/**
 * Jira keys and Confluence page ids mentioned in free text: bare keys such as CP-50908, page
 * URLs (/pages/<id>) and ?pageId=<id>. Same regexes and order as po-brd; deduplicated.
 */
export function extractRefs(text: string): string[] {
  const refs = [
    ...[...text.matchAll(/\b([A-Z][A-Z0-9]+-\d+)\b/g)].map((m) => m[1] ?? ""),
    ...[...text.matchAll(/\/pages\/(?:[^\s/]+\/)*?(\d{5,})\b/g)].map((m) => m[1] ?? ""),
    ...[...text.matchAll(/[?&]pageId=(\d+)/g)].map((m) => m[1] ?? ""),
  ];
  return [...new Set(refs.filter((ref) => ref !== ""))];
}

/** Strict Jira key check (the SourcesPicker validation): `^[A-Z][A-Z0-9]+-\d+$`. */
export function isJiraKey(value: string): boolean {
  return JIRA_KEY.test(value.trim());
}

/**
 * A Jira key from what a person typed or pasted: a key in any case, or a browse URL.
 * Returns the upper-case key, or null.
 */
export function parseJiraRef(value: string): string | null {
  const trimmed = value.trim();
  if (JIRA_KEY.test(trimmed.toUpperCase()) && !/\s/.test(trimmed)) return trimmed.toUpperCase();
  const browse = JIRA_BROWSE.exec(trimmed);
  return browse?.[1] ? browse[1].toUpperCase() : null;
}

/**
 * A Confluence page id from digits or a page URL (…/pages/<id>/… or ?pageId=<id>).
 * po-brd decides a ref's kind with /^\d+$/, so the UI always sends the bare id.
 */
export function parseConfluenceRef(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const byPath = CONFLUENCE_PAGES.exec(trimmed);
  if (byPath?.[1]) return byPath[1];
  const byQuery = CONFLUENCE_PAGE_ID.exec(trimmed);
  return byQuery?.[1] ?? null;
}

export type ParsedRef = { kind: "jira" | "confluence"; value: string };

/** Either kind of ref, normalized, or null when the text is neither. */
export function parseRef(value: string): ParsedRef | null {
  const jira = parseJiraRef(value);
  if (jira) return { kind: "jira", value: jira };
  const page = parseConfluenceRef(value);
  if (page) return { kind: "confluence", value: page };
  return null;
}

/** The kind po-brd assigns to an `add` entry: all digits is Confluence, anything else Jira. */
export function refKind(ref: string): "jira" | "confluence" {
  return /^\d+$/.test(ref) ? "confluence" : "jira";
}
