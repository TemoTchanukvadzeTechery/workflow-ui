import "server-only";
/**
 * The mock Jira and Confluence the discovery step talks to. `runAtl` answers the read-only atl
 * commands the real workflow allows (jira issue get/list, jira project ls, confluence search,
 * confluence page get, confluence space ls) with output shaped like atl's, so the run ledger
 * shows believable commands and results. Unknown refs fail like a missing or forbidden issue.
 */
import { agrCatalog } from "./agr";
import { packCatalog } from "./packs";
import type { CatalogItem } from "./types";

export type { CatalogItem } from "./types";

let items: Map<string, CatalogItem> | undefined;

function catalog(): Map<string, CatalogItem> {
  if (!items) {
    items = new Map();
    for (const item of [...agrCatalog(), ...packCatalog()]) items.set(item.ref, item);
  }
  return items;
}

export function catalogItem(ref: string): CatalogItem | undefined {
  return catalog().get(ref);
}

export function catalogItems(): CatalogItem[] {
  return [...catalog().values()];
}

function haystack(item: CatalogItem): string {
  const links = (item.links ?? []).map((l) => l.ref).join(" ");
  return `${item.ref} ${item.title} ${item.description} ${(item.keywords ?? []).join(" ")} ${item.parent ?? ""} ${links}`.toLowerCase();
}

function phraseMatches(item: CatalogItem, phrase: string): boolean {
  const words = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const hay = haystack(item);
  return words.every((w) => hay.includes(w));
}

/** Items matching any of the terms, best first (more matching terms, then title hits). */
export function searchCatalog(terms: readonly string[], opts: { kind?: CatalogItem["kind"]; limit?: number; exclude?: readonly string[] } = {}): CatalogItem[] {
  const exclude = new Set(opts.exclude ?? []);
  const scored = catalogItems()
    .filter((item) => (!opts.kind || item.kind === opts.kind) && !exclude.has(item.ref))
    .map((item) => {
      const title = item.title.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (!phraseMatches(item, term)) continue;
        score += title.includes(term.toLowerCase()) ? 3 : 1;
      }
      return { item, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.item.ref.localeCompare(b.item.ref));
  return scored.slice(0, opts.limit ?? 25).map((s) => s.item);
}

// ---------------------------------------------------------------------------------------------
// Query parsing (a small subset of JQL and CQL, enough for the planner's commands)
// ---------------------------------------------------------------------------------------------

interface Query {
  parents: string[];
  projects: string[];
  types: string[];
  spaces: string[];
  phrases: string[];
}

function parseQuery(q: string): Query {
  const parents: string[] = [];
  for (const m of q.matchAll(/parent\s*(?:=\s*([A-Z][A-Z0-9]+-\d+)|in\s*\(([^)]*)\))/gi)) {
    if (m[1]) parents.push(m[1]);
    if (m[2]) parents.push(...m[2].split(",").map((s) => s.trim().replace(/"/g, "")));
  }
  const projects = Array.from(q.matchAll(/project\s*=\s*"?([A-Z][A-Z0-9]*)"?/gi)).map((m) => (m[1] ?? "").toUpperCase());
  const types = Array.from(q.matchAll(/issuetype\s*=\s*"?([A-Za-z-]+)"?/gi)).map((m) => (m[1] ?? "").toLowerCase());
  const spaces = Array.from(q.matchAll(/space\s*=\s*"?([A-Za-z0-9]+)"?/gi)).map((m) => (m[1] ?? "").toUpperCase());
  const phrases = Array.from(q.matchAll(/(?:text|summary|title)\s*~\s*"([^"]*)"/gi)).map((m) => m[1] ?? "");
  // A bare query with no clauses, e.g. `confluence search "reorder reminders"`, is a text search.
  if (!/[=~]/.test(q) && q.trim()) phrases.push(q.replace(/"/g, "").trim());
  return { parents, projects, types, spaces, phrases };
}

function matches(item: CatalogItem, q: Query): boolean {
  if (q.parents.length > 0 && !(item.parent && q.parents.includes(item.parent))) return false;
  if (q.projects.length > 0 && !q.projects.includes(item.ref.split("-")[0] ?? "")) return false;
  if (q.types.length > 0 && !q.types.includes(item.type.toLowerCase())) return false;
  if (q.spaces.length > 0 && !(item.space && q.spaces.includes(item.space))) return false;
  if (q.phrases.length > 0 && !q.phrases.some((p) => phraseMatches(item, p))) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Output rendering, shaped like atl's
// ---------------------------------------------------------------------------------------------

function pad(text: string, width: number): string {
  return text.length >= width ? `${text.slice(0, width - 1)} ` : text.padEnd(width);
}

function issueRef(ref: string) {
  const item = catalogItem(ref);
  return { key: ref, fields: { summary: item?.title ?? "", status: { name: item?.status ?? "" }, issuetype: { name: item?.type ?? "" } } };
}

function issueJson(item: CatalogItem): string {
  const fields: Record<string, unknown> = {
    summary: item.title,
    issuetype: { name: item.type },
    status: { name: item.status ?? "" },
    labels: item.labels ?? [],
    assignee: item.assignee ? { displayName: item.assignee } : null,
    updated: `${item.modified ?? "2026-09-01"}T10:00:00.000-0700`,
    issuelinks: (item.links ?? []).map((l) => ({ type: { outward: l.type, inward: l.type }, outwardIssue: issueRef(l.ref) })),
    subtasks: [],
    description: item.description,
  };
  if (item.parent) fields.parent = issueRef(item.parent);
  return JSON.stringify({ key: item.ref, fields }, null, 2);
}

function issueTable(item: CatalogItem): string {
  return [
    `KEY       ${item.ref}`,
    `SUMMARY   ${item.title}`,
    `TYPE      ${item.type}`,
    `STATUS    ${item.status ?? ""}`,
    `PARENT    ${item.parent ?? "-"}`,
    `ASSIGNEE  ${item.assignee ?? "-"}`,
    `UPDATED   ${item.modified ?? "2026-09-01"}`,
  ].join("\n");
}

function pageBody(item: CatalogItem): string {
  const paras = item.description
    .split("\n")
    .filter(Boolean)
    .map((p) => `<p>${escapeXml(p)}</p>`)
    .join("");
  return `<h1>${escapeXml(item.title)}</h1>${paras}`;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const SPACES: Array<[string, string]> = [
  ["AR", "Architecture"],
  ["CMS", "Content Management"],
  ["ENG", "Engineering"],
  ["LEG", "Legal"],
  ["PSE", "Product & Solution Engineering"],
  ["REL", "Releases"],
  ["SD", "Solution Design"],
  ["SE", "Solution Engineering"],
  ["SEC", "Security"],
];

const PROJECTS: Array<[string, string]> = [
  ["CP", "Customer Portal & Platform"],
  ["CS", "Customer Service"],
  ["DATA", "Data Engineering"],
  ["DV", "DevOps"],
  ["ECOM", "E-commerce"],
  ["LEGAL", "Legal Requests"],
  ["MKT", "Marketing"],
  ["PLAN", "Planning"],
];

export interface AtlResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function flag(args: readonly string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === name) return args[i + 1];
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
  }
  return undefined;
}

function positionals(args: readonly string[], skip: number): string[] {
  const out: string[] = [];
  const valueFlags = new Set(["--fields", "--jql", "--limit", "-o"]);
  for (let i = skip; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a.startsWith("-")) {
      if (valueFlags.has(a)) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

const NOT_FOUND = (ref: string): AtlResult => ({
  exitCode: 1,
  stdout: "",
  stderr: `Error: ${/^\d+$/.test(ref) ? `page ${ref} not found or you do not have permission to view it` : `issue ${ref} does not exist or you do not have permission to see it`} (404)`,
});

/** Answers one allow-listed atl read command (argv without the binary). */
export function runAtl(args: readonly string[]): AtlResult {
  const path = args.slice(0, 3).join(" ");
  const json = flag(args, "-o") === "json";
  const limit = Number(flag(args, "--limit") ?? "25") || 25;

  if (path === "jira issue get") {
    const ref = positionals(args, 3)[0] ?? "";
    const item = catalogItem(ref);
    if (!item || item.kind !== "jira" || item.restricted) return NOT_FOUND(ref);
    return { exitCode: 0, stdout: json ? issueJson(item) : issueTable(item), stderr: "" };
  }
  if (path === "jira issue list") {
    const q = parseQuery(flag(args, "--jql") ?? positionals(args, 3)[0] ?? "");
    const found = catalogItems()
      .filter((i) => i.kind === "jira" && matches(i, q))
      .sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))
      .slice(0, limit);
    if (json) return { exitCode: 0, stdout: JSON.stringify({ total: found.length, issues: found.map((i) => issueRef(i.ref)) }, null, 2), stderr: "" };
    const rows = found.map((i) => `${pad(i.ref, 10)}${pad(i.title, 72)}${pad(i.status ?? "", 13)}${i.assignee ?? ""}`.trimEnd());
    return { exitCode: 0, stdout: [`${pad("KEY", 10)}${pad("SUMMARY", 72)}${pad("STATUS", 13)}ASSIGNEE`, ...rows].join("\n"), stderr: "" };
  }
  if (path === "jira project ls") {
    const rows = PROJECTS.slice(0, limit).map(([k, n]) => `${pad(k, 8)}${n}`);
    return { exitCode: 0, stdout: [`${pad("KEY", 8)}NAME`, ...rows].join("\n"), stderr: "" };
  }
  if (path === "confluence search") {
    const q = parseQuery(positionals(args, 2)[0] ?? "");
    const found = catalogItems()
      .filter((i) => i.kind === "confluence" && matches(i, q))
      .slice(0, limit);
    if (json) {
      const results = found.map((i) => ({
        title: i.title,
        excerpt: i.description.slice(0, 160),
        lastModified: `${i.modified ?? "2026-09-01"}T10:00:00.000Z`,
        content: { id: i.ref, title: i.title },
        resultGlobalContainer: { displayUrl: `/spaces/${i.space ?? "PSE"}` },
      }));
      return { exitCode: 0, stdout: JSON.stringify({ results, size: results.length }, null, 2), stderr: "" };
    }
    const rows = found.map((i) => `${pad(i.ref, 13)}${pad(i.title, 80)}${pad(i.space ?? "", 7)}${i.modified ?? ""}`.trimEnd());
    return { exitCode: 0, stdout: [`${pad("ID", 13)}${pad("TITLE", 80)}${pad("SPACE", 7)}LAST MODIFIED`, ...rows].join("\n"), stderr: "" };
  }
  if (path === "confluence page get") {
    const ref = positionals(args, 3)[0] ?? "";
    const item = catalogItem(ref);
    if (!item || item.kind !== "confluence" || item.restricted) return NOT_FOUND(ref);
    return { exitCode: 0, stdout: args.includes("--body") ? pageBody(item) : `${pad("ID", 13)}${item.ref}\nTITLE        ${item.title}\nSPACE        ${item.space ?? ""}`, stderr: "" };
  }
  if (path === "confluence space ls") {
    const rows = SPACES.slice(0, limit).map(([k, n]) => `${pad(k, 8)}${n}`);
    return { exitCode: 0, stdout: [`${pad("KEY", 8)}NAME`, ...rows].join("\n"), stderr: "" };
  }
  return { exitCode: 2, stdout: "", stderr: `Error: unknown command "${path}"` };
}
