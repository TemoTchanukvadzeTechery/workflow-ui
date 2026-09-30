import "server-only";
/**
 * The shared memory file (memory/memory.md): its template, register parsing and line diff are
 * ported from po-brd/lib/memory.ts; the fact and register editing helpers are what the mock
 * memory agent uses to build a proposal that keeps the file's outer structure.
 */
import { escapeRegExp } from "@/server/mock/workflows/lib/text";

export const MEMORY_PATH = "memory/memory.md";
export const REGISTER = "Document register";

export const FACT_SECTIONS = [
  "Stakeholders and teams",
  "Product KPIs",
  "Systems and services",
  "Integration conventions",
  "Standing decisions and constraints",
  "Glossary",
] as const;
export type FactSection = (typeof FACT_SECTIONS)[number];

export const MEMORY_TEMPLATE = `# Shared memory

Facts shared by the po-brd and architect-aad workflows, and the register of accepted BRDs and AADs. A workflow proposes an update after a document is accepted; the person who accepted it (the PO for a BRD, the architect for an AAD) approves each one. Edit by hand when needed.

## Shared facts

### Stakeholders and teams

### Product KPIs

### Systems and services

### Integration conventions

### Standing decisions and constraints

### Glossary

## ${REGISTER}
`;

export type DocType = "BRD" | "AAD";

export interface RegisterEntry {
  title: string;
  path: string;
  sha256: string;
  type?: DocType;
}

/** Register entries: `### <title>` blocks with `- Type:`, `- Path:` and `- Accepted sha256:` lines. */
export function registerEntries(memory: string, heading = REGISTER): RegisterEntry[] {
  const register = memory.split(new RegExp(`^## ${escapeRegExp(heading)}\\s*$`, "m"))[1] ?? "";
  return register
    .split(/^### /m)
    .slice(1)
    .flatMap((block) => {
      const title = block.split("\n")[0]?.trim() ?? "";
      const path = /^- Path: `([^`]+)`/m.exec(block)?.[1];
      const sha256 = /^- Accepted sha256: `([0-9a-f]{64})`/m.exec(block)?.[1];
      const type = /^- Type: (BRD|AAD)\b/m.exec(block)?.[1] as DocType | undefined;
      if (path === undefined || sha256 === undefined) return [];
      return [{ title, path, sha256, ...(type ? { type } : {}) }];
    });
}

export function registerTitles(memory: string): RegisterEntry[] {
  return registerEntries(memory);
}

/** A plain line diff for the review attachment (LCS table), "+ "/"- " lines only. */
export function lineDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const width = b.length + 1;
  const lcs = new Array<number>((a.length + 1) * width).fill(0);
  const at = (i: number, j: number): number => lcs[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (j < b.length && (i === a.length || at(i, j + 1) >= at(i + 1, j))) {
      out.push(`+ ${b[j++] ?? ""}`);
    } else {
      out.push(`- ${a[i++] ?? ""}`);
    }
  }
  return out.length > 0 ? out.join("\n") : "(no change)";
}

/** Makes sure the memory has the template's headings, so facts and entries have somewhere to go. */
export function ensureStructure(memory: string): string {
  let md = memory.trim() ? memory.replace(/\s+$/, "") + "\n" : MEMORY_TEMPLATE;
  if (!/^## Shared facts\s*$/m.test(md)) {
    md = md.replace(new RegExp(`^## ${escapeRegExp(REGISTER)}\\s*$`, "m"), (m) => `## Shared facts\n\n${m}`);
    if (!/^## Shared facts\s*$/m.test(md)) md += "\n## Shared facts\n";
  }
  for (const s of FACT_SECTIONS) {
    if (new RegExp(`^### ${escapeRegExp(s)}\\s*$`, "m").test(md)) continue;
    const reg = new RegExp(`^## ${escapeRegExp(REGISTER)}\\s*$`, "m");
    md = reg.test(md) ? md.replace(reg, (m) => `### ${s}\n\n${m}`) : `${md}\n### ${s}\n`;
  }
  if (!new RegExp(`^## ${escapeRegExp(REGISTER)}\\s*$`, "m").test(md)) md = `${md.replace(/\s+$/, "")}\n\n## ${REGISTER}\n`;
  return md;
}

/** Strips the trailing source tag, e.g. "[`brd/x.md`]", so facts compare by what they say. */
export function factKey(line: string): string {
  return line
    .replace(/^\s*-\s*/, "")
    .replace(/\s*\[`[^`]+`\]\s*$/, "")
    .trim()
    .toLowerCase();
}

export function hasFact(memory: string, line: string): boolean {
  const key = factKey(line);
  return memory.split("\n").some((l) => /^\s*-\s/.test(l) && factKey(l) === key);
}

/** Appends a fact line at the end of its "### <section>" list under Shared facts. */
export function insertFact(memory: string, section: FactSection, line: string): string {
  const all = memory.split("\n");
  const idx = all.findIndex((l) => l.trim() === `### ${section}`);
  if (idx < 0) return memory;
  let end = all.length;
  for (let i = idx + 1; i < all.length; i++) {
    if (/^#{2,3}\s/.test(all[i] ?? "")) {
      end = i;
      break;
    }
  }
  let last = end;
  while (last > idx + 1 && (all[last - 1] ?? "").trim() === "") last--;
  const insert = last === idx + 1 ? ["", line] : [line];
  const rest = all.slice(last);
  const needsGap = rest.length > 0 && (rest[0] ?? "").trim() !== "";
  return [...all.slice(0, last), ...insert, ...(needsGap ? [""] : []), ...rest].join("\n");
}

/** Line range [start, end) of a register block matching the predicate. */
function registerBlockRange(all: string[], match: (block: string, title: string) => boolean): [number, number] | undefined {
  const regIdx = all.findIndex((l) => l.trim() === `## ${REGISTER}`);
  if (regIdx < 0) return undefined;
  for (let i = regIdx + 1; i < all.length; i++) {
    if (!(all[i] ?? "").startsWith("### ")) continue;
    let end = all.length;
    for (let j = i + 1; j < all.length; j++) {
      if (/^#{2,3}\s/.test(all[j] ?? "")) {
        end = j;
        break;
      }
    }
    const block = all.slice(i, end).join("\n");
    if (match(block, (all[i] ?? "").slice(4).trim())) return [i, end];
    i = end - 1;
  }
  return undefined;
}

export function findRegisterBlock(memory: string, match: (block: string, title: string) => boolean): string | undefined {
  const all = memory.split("\n");
  const r = registerBlockRange(all, match);
  return r ? all.slice(r[0], r[1]).join("\n").trim() : undefined;
}

/** Replaces the matching register block, or appends the new block at the end of the register. */
export function upsertRegisterBlock(memory: string, match: (block: string, title: string) => boolean, block: string): string {
  const all = memory.split("\n");
  const r = registerBlockRange(all, match);
  if (r) {
    const rest = all.slice(r[1]);
    return [...all.slice(0, r[0]), ...block.trim().split("\n"), ...(rest.length > 0 ? ["", ...rest.filter((l, i) => !(i === 0 && l.trim() === ""))] : [""])].join("\n");
  }
  return `${memory.replace(/\s+$/, "")}\n\n${block.trim()}\n`;
}
