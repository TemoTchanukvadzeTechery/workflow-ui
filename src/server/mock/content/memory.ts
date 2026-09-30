import "server-only";
/**
 * The mock memory agent ("memory:propose"): proposes the complete new memory file for one
 * accepted BRD or AAD. It keeps the file's outer structure and every other document's entries,
 * adds the shared facts this document states (skipping ones already recorded), and writes or
 * replaces the document's register entry with its bookkeeping lines. A pack can supply the real
 * facts, entry text and change list (AGR does, from the fixture); otherwise they are derived
 * from the accepted document itself, so human edits show up in the proposal.
 */
import { stripCites, brdRequirements, bulletItems, docTitle, numberedItems, openQuestions, sectionBody, sourceRows, systemChanges, aadFrs } from "./doc/parse";
import { ensureStructure, factKey, findRegisterBlock, hasFact, insertFact, upsertRegisterBlock, type FactSection } from "./memory-doc";
import { pickPack } from "./packs";
import type { MemoryChange, MemoryProposal, ProposeMemoryOptions } from "./types";

export interface PackMemory {
  facts: Array<{ section: FactSection; text: string }>;
  /** Register entry text after the four bookkeeping lines (may start with more "- " lines). */
  entry: string;
  changes: MemoryChange[];
  affectsOtherDocuments: string[];
}

export interface MemoryInput extends ProposeMemoryOptions {
  /** The document's current register block, when it already has one. */
  previousBlock?: string;
}

function short(text: string, max = 110): string {
  const t = stripCites(text).replace(/\s+/g, " ").trim();
  return t.length <= max ? t.replace(/\.$/, "") : `${t.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

function lowerFirst(text: string): string {
  // Keep acronyms and keys ("CSV", "CP-50908") as written.
  if (/^[A-Z0-9]{2}/.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function refsOf(md: string): Array<{ id: string; label: string }> {
  return sourceRows(md)
    .filter((r) => /^R\d+$/.test(r[0] ?? ""))
    .map((r) => ({ id: r[0] ?? "", label: (r[4] ?? "").replace(/\s+—\s+/, " — ") }));
}

/** Facts, register entry and changes derived from an accepted BRD. */
export function brdMemory(opts: MemoryInput): PackMemory {
  const md = opts.content;
  const path = opts.path;
  const title = docTitle(md);
  const reqs = brdRequirements(md);
  const main = reqs.filter((r) => !r.candidate);
  const cands = reqs.filter((r) => r.candidate);
  const lead = sectionBody(md, "Business and Product Lead") ?? "";
  const leadKnown = !/^Not yet provided/.test(lead);
  const problem = stripCites((sectionBody(md, "Problem to be Solved") ?? "").split("\n\n")[0] ?? "");
  // The register's "Scope:" line describes what is being built (the solution's first paragraph), as the real entry does.
  const solution = stripCites((sectionBody(md, "Proposed Solution") ?? "").split("\n\n")[0] ?? "");
  const scope = lowerFirst(short(solution || problem, 220).replace(/[.\s]+$/, ""));
  const out = bulletItems(sectionBody(md, "Out of Scope") ?? "").map((o) => short(o, 80));
  const metrics = numberedItems(sectionBody(md, "Success Metrics") ?? "");
  const questions = openQuestions(md);
  const refs = refsOf(md);
  const isNew = !opts.previousBlock;

  const facts: PackMemory["facts"] = [];
  if (leadKnown) facts.push({ section: "Stakeholders and teams", text: `${title}: ${short(lead.split("\n\n")[0] ?? lead, 160)}.` });

  const entry = [
    `- Status: accepted by the PO; ${isNew ? "first accepted version, no prior committed version" : "revised version replacing the earlier accepted one"}.`,
    `- Leads: ${leadKnown ? short(lead, 120) : "none named. Business and Product Lead is unresolved"}.`,
    "",
    `Scope: ${scope || title}${/…$/.test(scope) ? "" : "."} Requirements cover ${main.map((r) => lowerFirst(short(r.text, 70))).join("; ")}.${cands.length > 0 ? ` ${cands.length === 1 ? "One candidate requirement is" : `${cands.length} candidate requirements are`} unconfirmed: ${cands.map((r) => lowerFirst(short(r.text.replace(/\(Candidate\)\s*/i, ""), 70))).join("; ")}.` : ""}`,
    "",
    `Out of scope: ${out.join("; ") || "not stated"}.`,
    "",
    `Open questions (${questions.length}): ${questions.slice(0, 5).map((q) => `${q.id} ${short(q.text, 70)}`).join("; ")}${questions.length > 5 ? "; and others" : ""}.`,
    "",
    `Dependencies: ${refs.map((r) => r.label).join("; ") || "none confirmed"}.`,
  ].join("\n");

  const changes: MemoryChange[] = [
    { kind: "other", summary: `${isNew ? "First accepted version of this BRD; new register entry created" : "Revised version of this BRD accepted; register entry updated"} for "${title}" (\`${path}\`).` },
    { kind: "requirement", summary: `${main.length} requirements accepted: ${main.map((r) => lowerFirst(short(r.text, 60))).join("; ")} (\`${path}\` Requirements).${cands.length > 0 ? ` ${cands.length} candidate requirement${cands.length === 1 ? "" : "s"} remain unconfirmed.` : ""}` },
    { kind: "scope", summary: `Out of scope: ${out.slice(0, 4).join("; ") || "not stated"} (\`${path}\` Out of Scope).` },
    { kind: "lead", summary: leadKnown ? `${short(lead, 120)} (\`${path}\` Business and Product Lead).` : `Business and Product Lead unassigned — no source names a business stakeholder or Product Manager (\`${path}\` Business and Product Lead).` },
    { kind: "metric", summary: `${metrics.length} candidate success metrics recorded, all unvalidated with BI and without baseline, target, owner, or date (\`${path}\` Success Metrics).` },
  ];
  if (refs.length > 0) changes.push({ kind: "dependency", summary: `Dependencies recorded on ${refs.slice(0, 6).map((r) => r.label.split(" — ")[0]).join(", ")}${refs.length > 6 ? ` and ${refs.length - 6} more` : ""} (\`${path}\` Sources).` });
  return { facts, entry, changes, affectsOtherDocuments: [] };
}

/** Facts, register entry and changes derived from an accepted AAD. */
export function aadMemory(opts: MemoryInput): PackMemory {
  const md = opts.content;
  const path = opts.path;
  const title = docTitle(md);
  const systems = systemChanges(md);
  const frs = aadFrs(md);
  const questions = openQuestions(md);
  const refs = refsOf(md);
  const brdRow = sourceRows(md).find((r) => r[0] === "B1");
  const brdPath = /`([^`]+)`/.exec(brdRow?.[4] ?? "")?.[1];
  const proposed = systems.filter((s) => /^proposed/i.test(s.status));
  const notUsed = systems.filter((s) => /not used/i.test(s.status));
  const endpoints = frs.filter((f) => /endpoint|job|export/i.test(f.design)).map((f) => short(f.design, 90));
  const problem = stripCites((sectionBody(md, "Problem statement", 3) ?? "").split("\n\n")[0] ?? "");

  const facts: PackMemory["facts"] = [];
  for (const s of proposed) {
    if (/launchdarkly|api-gateway/i.test(s.system)) continue;
    if (new RegExp(`\\*\\*${s.system.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\*\\*`).test(opts.base)) continue;
    facts.push({ section: "Systems and services", text: `**${s.system}** — ${short(s.change, 140)} (proposed in the ${title} AAD).` });
  }
  for (const s of notUsed) facts.push({ section: "Standing decisions and constraints", text: `No new ${/report/i.test(s.system) ? "reporting path" : "work"} may depend on ${s.system}: ${lowerFirst(short(s.change, 100))}.` });

  const entry = [
    `${short(problem, 260) || title}.`,
    "",
    `**Systems touched.** ${systems.map((s) => `${s.system} (${s.status.toLowerCase()})`).join("; ")}.`,
    "",
    `**Interfaces and events introduced.** ${endpoints.length > 0 ? `${endpoints.join("; ")} — all proposed and not yet agreed.` : "No new interface or event."}`,
    "",
    `**Open questions (${questions.length}${questions.length > 0 ? `, Q1–Q${questions.length}` : ""}).** ${questions.slice(0, 5).map((q) => `${q.id} ${short(q.text, 70)}`).join("; ")}${questions.length > 5 ? "; and others" : ""}.`,
    "",
    `**Dependencies.** ${brdPath ? `Accepted BRD \`${brdPath}\`; ` : ""}${refs.map((r) => r.label.split(" — ")[0]).join(", ") || "none confirmed"}.`,
    "",
    "**Status.** Accepted by the architect as an AAD draft. Not ARB-approved and not department signed-off; no approval is recorded in the Document Acceptance table.",
  ].join("\n");

  const isNew = !opts.previousBlock;
  const changes: MemoryChange[] = [
    { kind: "scope", summary: `${isNew ? "New AAD accepted" : "Revised AAD accepted"}: ${title} (\`${path}\`).` },
    ...(proposed.length > 0 ? [{ kind: "system" as const, summary: `Systems entering scope as proposed: ${proposed.map((s) => s.system).join(", ")} (\`${path}\` §High-Level Architecture).` }] : []),
    ...(endpoints.length > 0 ? [{ kind: "interface" as const, summary: `Proposed interfaces: ${endpoints.slice(0, 3).join("; ")} (\`${path}\` §Functional Requirements).` }] : []),
    ...notUsed.map((s) => ({ kind: "decision" as const, summary: `${s.system} is explicitly not used: ${lowerFirst(short(s.change, 90))} (\`${path}\` §High-Level Architecture).` })),
    { kind: "dependency", summary: `Dependencies recorded: ${brdPath ? `accepted BRD \`${brdPath}\`; ` : ""}${refs.slice(0, 5).map((r) => r.label.split(" — ")[0]).join(", ") || "none"} (\`${path}\` §References).` },
  ];
  return { facts, entry, changes, affectsOtherDocuments: [] };
}

function registerBlock(opts: ProposeMemoryOptions, title: string, entry: string): string {
  const head = [`### ${title}`, "", `- Type: ${opts.docType}`, `- Path: \`${opts.path}\``, `- Accepted sha256: \`${opts.sha256}\``, `- Run: \`${opts.runId}\``];
  return entry.startsWith("- ") ? [...head, entry].join("\n") : [...head, "", entry].join("\n");
}

function summaryOf(block: string): string {
  return block
    .split("\n")
    .filter((l) => !/^(### |- (Type|Path|Accepted sha256|Run|Status):)/.test(l))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

/** The proposal for one accepted document. */
export function proposeMemory(opts: ProposeMemoryOptions): MemoryProposal {
  const base = ensureStructure(opts.base);
  const title = docTitle(opts.content) || opts.path;
  const byPath = (block: string) => block.includes(`- Path: \`${opts.path}\``);
  const byTitle = (block: string, t: string) => t === title && block.includes(`- Type: ${opts.docType}`);
  const previousByPath = findRegisterBlock(base, byPath);
  const previousByTitle = previousByPath ? undefined : findRegisterBlock(base, byTitle);
  const previousBlock = previousByPath ?? previousByTitle;
  const input: MemoryInput = { ...opts, base, previousBlock };

  const pack = pickPack(opts.projectId, opts.path);
  const pm = pack?.memory?.[opts.docType]?.(input) ?? (opts.docType === "BRD" ? brdMemory(input) : aadMemory(input));

  let proposed = base;
  // A document registered under another path moved: its facts follow it to the new path.
  const oldPath = previousByTitle ? /- Path: `([^`]+)`/.exec(previousByTitle)?.[1] : undefined;
  if (oldPath && oldPath !== opts.path) proposed = proposed.split(`[\`${oldPath}\`]`).join(`[\`${opts.path}\`]`);

  let added = 0;
  for (const fact of pm.facts) {
    const line = `- ${fact.text} [\`${opts.path}\`]`;
    if (hasFact(proposed, line)) continue;
    proposed = insertFact(proposed, fact.section, line);
    added++;
  }
  const block = registerBlock(opts, title, pm.entry);
  proposed = upsertRegisterBlock(proposed, previousByPath ? byPath : byTitle, block);

  let major = true;
  let changes = pm.changes;
  if (previousByPath && added === 0 && summaryOf(previousByPath) === summaryOf(block)) {
    major = false;
    changes = [{ kind: "other", summary: `Bookkeeping lines updated for the newly accepted version of "${title}" (\`${opts.path}\`); no shared fact or register summary changed.` }];
  }
  return { major, changes, affectsOtherDocuments: pm.affectsOtherDocuments, proposedMemory: proposed };
}

export { factKey };
