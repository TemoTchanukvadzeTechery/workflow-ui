import "server-only";
/**
 * The atl allowlist and output compaction, ported from po-brd/lib/discovery.ts. Agents never
 * run atl themselves: the planner proposes argv arrays, the workflow validates and runs them.
 */

interface CommandSpec {
  positional: [number, number];
  pattern?: RegExp;
  flags: Record<string, boolean>;
}

const ISSUE_KEY = /^[A-Z][A-Z0-9]+-\d+$/;
const PAGE_ID = /^\d+$/;
const OUTPUT = { "-o": true };

export const ATL_COMMANDS: Record<string, CommandSpec> = {
  "jira issue get": { positional: [1, 1], pattern: ISSUE_KEY, flags: { "--fields": true, ...OUTPUT } },
  "jira issue list": { positional: [0, 1], flags: { "--fields": true, "--jql": true, "--limit": true, ...OUTPUT } },
  "jira project ls": { positional: [0, 0], flags: { "--limit": true, ...OUTPUT } },
  "confluence search": { positional: [1, 1], flags: { "--limit": true, ...OUTPUT } },
  "confluence page get": { positional: [1, 1], pattern: PAGE_ID, flags: { "--body": false, ...OUTPUT } },
  "confluence space ls": { positional: [0, 0], flags: { "--limit": true, ...OUTPUT } },
};

export const MAX_LIMIT = 25;

export type Validated = { ok: true; argv: string[] } | { ok: false; reason: string };

/** Accepts only allowlisted read commands; returns the argv with non-interactive flags. */
export function validateAtl(args: readonly string[]): Validated {
  const path = [3, 2].map((n) => args.slice(0, n).join(" ")).find((p) => ATL_COMMANDS[p] !== undefined);
  const spec = path === undefined ? undefined : ATL_COMMANDS[path];
  if (path === undefined || spec === undefined) return { ok: false, reason: `"${args.slice(0, 3).join(" ")}" is not an allowed read command` };
  const positional: string[] = [];
  const rest = args.slice(path.split(" ").length);
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i] ?? "";
    if (word.startsWith("-")) {
      const eq = word.indexOf("=");
      const flag = eq >= 0 ? word.slice(0, eq) : word;
      const inline = eq >= 0 ? word.slice(eq + 1) : undefined;
      const takesValue = spec.flags[flag];
      if (takesValue === undefined) return { ok: false, reason: `flag ${flag} is not allowed for "${path}"` };
      if (!takesValue) continue;
      const value = inline ?? rest[++i];
      if (value === undefined) return { ok: false, reason: `flag ${flag} needs a value` };
      if (flag === "-o" && value !== "table" && value !== "json") return { ok: false, reason: "-o must be table or json" };
      if (flag === "--limit" && !(/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= MAX_LIMIT)) {
        return { ok: false, reason: `--limit must be between 1 and ${MAX_LIMIT}` };
      }
    } else {
      if (spec.pattern && !spec.pattern.test(word)) return { ok: false, reason: `"${word}" is not a valid argument for "${path}"` };
      positional.push(word);
    }
  }
  const [min, max] = spec.positional;
  if (positional.length < min || positional.length > max) return { ok: false, reason: `"${path}" takes ${min}-${max} positional arguments` };
  return { ok: true, argv: [...args, "--no-input", "--no-color"] };
}

/** The command that fetches the full content of a Jira issue or Confluence page reference. */
export function fetchArgs(ref: string): string[] | undefined {
  if (ISSUE_KEY.test(ref)) return ["jira", "issue", "get", ref, "-o", "json"];
  if (PAGE_ID.test(ref)) return ["confluence", "page", "get", ref, "--body"];
  return undefined;
}

/** Shrinks verbose atl output to the fields a document needs; falls back to the raw text. */
export function compactOutput(args: readonly string[], stdout: string): string {
  const path = args.slice(0, 3).join(" ");
  const json = args.includes("-o") && args[args.indexOf("-o") + 1] === "json";
  try {
    if (path === "confluence page get" && args.includes("--body")) return storageToText(stdout);
    if (path === "jira issue get" && json) return jiraToText(JSON.parse(stdout) as JiraIssue);
    if (path.startsWith("confluence search") && json) {
      const results = (JSON.parse(stdout) as { results?: SearchHit[] }).results ?? [];
      return (
        results
          .map(
            (r) =>
              `- ${r.content?.id ?? "?"} [${r.resultGlobalContainer?.displayUrl ?? ""}] ${r.title ?? r.content?.title ?? ""} (modified ${r.lastModified ?? "?"})${r.excerpt ? `: ${storageToText(r.excerpt).replace(/\s+/g, " ").slice(0, 200)}` : ""}`,
          )
          .join("\n") || "no results"
      );
    }
    if (path === "jira issue list" && json) {
      const issues = (JSON.parse(stdout) as { issues?: JiraIssue[] }).issues ?? [];
      return issues.map((i) => `- ${i.key ?? "?"} [${i.fields?.issuetype?.name ?? ""}, ${i.fields?.status?.name ?? ""}] ${i.fields?.summary ?? ""}`).join("\n") || "no issues";
    }
  } catch {
    return stdout;
  }
  return stdout;
}

interface SearchHit {
  title?: string;
  excerpt?: string;
  lastModified?: string;
  content?: { id?: string; title?: string };
  resultGlobalContainer?: { displayUrl?: string };
}

interface JiraRef {
  key?: string;
  fields?: { summary?: string; status?: { name?: string }; issuetype?: { name?: string } };
}

interface JiraIssue extends JiraRef {
  fields?: JiraRef["fields"] & {
    labels?: string[];
    parent?: JiraRef;
    subtasks?: JiraRef[];
    issuelinks?: Array<{ type?: { inward?: string; outward?: string }; inwardIssue?: JiraRef; outwardIssue?: JiraRef }>;
    description?: unknown;
  };
}

/** The parts of a Jira issue a document needs: identity, hierarchy, links, and description. */
export function jiraToText(issue: JiraIssue): string {
  const f = issue.fields ?? {};
  const ref = (r: JiraRef | undefined): string => (r ? `${r.key ?? "?"} ${r.fields?.summary ?? ""}`.trim() : "none");
  const links = (f.issuelinks ?? []).map((l) =>
    l.outwardIssue ? `${l.type?.outward ?? "relates to"} ${ref(l.outwardIssue)}` : `${l.type?.inward ?? "relates to"} ${ref(l.inwardIssue)}`,
  );
  return [
    `KEY ${issue.key ?? "?"}`,
    `SUMMARY ${f.summary ?? ""}`,
    `TYPE ${f.issuetype?.name ?? ""}`,
    `STATUS ${f.status?.name ?? ""}`,
    `PARENT ${ref(f.parent)}`,
    `LABELS ${(f.labels ?? []).join(", ") || "none"}`,
    `LINKS${links.length > 0 ? `\n${links.map((l) => `- ${l}`).join("\n")}` : " none"}`,
    `SUBTASKS${(f.subtasks ?? []).length > 0 ? `\n${(f.subtasks ?? []).map((s) => `- ${ref(s)}`).join("\n")}` : " none"}`,
    `DESCRIPTION\n${adfToText(f.description).trim() || "none"}`,
  ].join("\n");
}

/** Plain text from an Atlassian Document Format node (strings pass through). */
export function adfToText(node: unknown): string {
  if (typeof node === "string") return node;
  if (node === null || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  const inner = (n.content ?? []).map(adfToText).join("");
  if (n.type === "listItem") return `- ${inner.trim()}\n`;
  if (n.type === "paragraph" || n.type === "heading" || n.type === "codeBlock" || n.type === "blockquote") return `${inner}\n`;
  if (n.type === "tableCell" || n.type === "tableHeader") return ` | ${inner.trim()}`;
  if (n.type === "tableRow") return `${inner}\n`;
  return inner;
}

/** Rough plain text from Confluence storage-format XHTML. */
export function storageToText(xhtml: string): string {
  return xhtml
    .replace(/<(?:br|\/p|\/li|\/tr|\/h[1-6]|\/div)\b[^>]*>/gi, "\n")
    .replace(/<(?:td|th)\b[^>]*>/gi, " | ")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A readable title from fetched content: the Jira SUMMARY line, else the first non-empty line. */
export function titleOf(text: string | undefined, ref: string): string {
  const lines = (text ?? "").split("\n").map((line) => line.trim());
  const summary = lines.find((line) => line.startsWith("SUMMARY "))?.slice("SUMMARY ".length);
  return summary || lines.find((line) => line !== "") || ref;
}

export function refKind(ref: string): "jira" | "confluence" {
  return /^\d+$/.test(ref) ? "confluence" : "jira";
}
