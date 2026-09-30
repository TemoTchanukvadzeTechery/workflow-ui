import "server-only";
/**
 * AGR, Ambassador Agreement Acceptance Reporting: the real po-workspace documents and run
 * records. The BRD and AAD are brd/brd.md and aad/aad.md verbatim (paths rewritten when the
 * project writes elsewhere), the planner rounds and dependency lists are those of runs 0035d37f
 * and f442e3a3, and the memory facts, register entries and change lists are the ones the PO and
 * architect approved into memory/memory.md.
 */
import type { ChangeKind } from "@/lib/weft/workflows";
import { agrFixture } from "../agr-fixture";
import { contentFile } from "../files";
import { FACT_SECTIONS, findRegisterBlock, type FactSection } from "../memory-doc";
import type { MemoryInput, PackMemory } from "../memory";
import type { DocType, MemoryChange } from "../types";
import type { ContentPack, ScriptedDiscovery } from "./types";

const REAL = { BRD: "brd/brd.md", AAD: "aad/aad.md" } as const;

function repath(text: string, from: string, to: string | undefined): string {
  return to && to !== from ? text.split(from).join(to) : text;
}

function scripted(doc: "brd" | "aad"): ScriptedDiscovery {
  return {
    rounds: agrFixture()[doc].rounds.map((r) => ({
      queries: r.queries,
      relevant: r.relevant.map((d) => ({ ref: d.ref, relation: d.relation, why: d.why, title: d.title })),
    })),
  };
}

/** Facts in the real memory tagged with this document's path, by section. */
function realFacts(docType: DocType): PackMemory["facts"] {
  const tag = `[\`${REAL[docType]}\`]`;
  const facts: PackMemory["facts"] = [];
  let section: FactSection | undefined;
  for (const line of contentFile("memory.md").split("\n")) {
    const h = /^### (.+)$/.exec(line);
    if (h) section = (FACT_SECTIONS as readonly string[]).includes(h[1] ?? "") ? (h[1] as FactSection) : undefined;
    if (/^## Document register/.test(line)) break;
    if (section && line.startsWith("- ") && line.trimEnd().endsWith(tag)) {
      facts.push({ section, text: line.slice(2).replace(` ${tag}`, "").trimEnd() });
    }
  }
  return facts;
}

/** The real register entry text after its bookkeeping lines. */
function realEntry(docType: DocType): string {
  const block = findRegisterBlock(contentFile("memory.md"), (b) => b.includes(`- Path: \`${REAL[docType]}\``)) ?? "";
  const lines = block.split("\n");
  const run = lines.findIndex((l) => l.startsWith("- Run:"));
  return lines
    .slice(run + 1)
    .join("\n")
    .replace(/^\n+/, "")
    .trim();
}

function realChanges(docType: DocType, path: string): MemoryChange[] {
  const list = docType === "BRD" ? agrFixture().brd.memoryChanges : agrFixture().aad.memoryChanges;
  return list.map((c) => {
    const i = c.indexOf(": ");
    return { kind: c.slice(0, i) as ChangeKind, summary: repath(c.slice(i + 2), REAL[docType], path) };
  });
}

function memory(docType: DocType) {
  return (opts: MemoryInput): PackMemory => {
    // The AAD entry names its BRD; follow the BRD to wherever this project keeps it.
    const brdPath = docType === "AAD" ? /^\| B1 \|[^\n]*`([^`]+)`/m.exec(opts.content)?.[1] : opts.path;
    const entry = repath(realEntry(docType), REAL.BRD, brdPath);
    return {
      facts: realFacts(docType),
      entry,
      changes: realChanges(docType, opts.path).map((c) => ({ ...c, summary: repath(c.summary, REAL.BRD, brdPath) })),
      affectsOtherDocuments: [],
    };
  };
}

export const agrPack: ContentPack = {
  id: "agreement-reporting",
  key: "AGR",
  title: "Ambassador Agreement Acceptance Reporting",
  brd: (ctx) => {
    const report = agrFixture().brd.report;
    return {
      content: repath(contentFile("agr-brd.md"), REAL.BRD, ctx.out),
      report: JSON.parse(repath(JSON.stringify(report), REAL.BRD, ctx.out)) as typeof report,
    };
  },
  aad: (ctx) => {
    const report = agrFixture().aad.report;
    const content = repath(repath(contentFile("agr-aad.md"), REAL.BRD, ctx.brd?.path), REAL.AAD, ctx.out);
    const json = repath(repath(JSON.stringify(report), REAL.BRD, ctx.brd?.path), REAL.AAD, ctx.out);
    return { content, report: JSON.parse(json) as typeof report };
  },
  discovery: { BRD: scripted("brd"), AAD: scripted("aad") },
  memory: { BRD: memory("BRD"), AAD: memory("AAD") },
};
