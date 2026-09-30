/**
 * Headings of a markdown document with the ids rehype-slug gives them: one github-slugger per
 * document, fed every heading (h1-h6) in order, so duplicates get the same -1, -2 suffixes.
 */
import GithubSlugger from "github-slugger";

export interface DocHeading {
  depth: number;
  text: string;
  id: string;
}

/** Plain text of an inline-markdown heading, approximating hast-util-to-string. */
export function headingText(raw: string): string {
  return raw
    .replace(/\s+#+\s*$/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_]([^*_]+)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
    .trim();
}

export function extractHeadings(markdown: string, prefix = ""): DocHeading[] {
  const slugger = new GithubSlugger();
  const out: DocHeading[] = [];
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f?.[1]) {
      if (fence === null) fence = f[1][0] ?? "`";
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (!m?.[1]) continue;
    const text = headingText(m[2] ?? "");
    if (!text) continue;
    out.push({ depth: m[1].length, text, id: prefix + slugger.slug(text) });
  }
  return out;
}
