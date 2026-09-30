import "server-only";
/**
 * The drafting agent's revision round (draft:2 and later). As the skills require, it starts from
 * the current file, which includes the human's own edits, and changes only the sections the
 * feedback and new notes affect: each feedback sentence is routed to the template section it
 * is about, an answered "Qn" is marked answered and leaves the blocking list, and new notes are
 * added to the Sources appendix. Compound feedback ("add X and move Y out of scope") is split into
 * one instruction per clause; "move Y out of scope" takes Y out of the requirements it appears in;
 * a figure from a note is evidence for the problem, not a requirement; and a requirement nobody
 * confirmed is added as "(Candidate)". Everything it did is listed under "Changes in this round".
 */
import type { AadReport, DraftReport } from "@/lib/delivery/types";
import { cell, isoDate, isStopword, keywords, numberedLines, sentences } from "@/server/mock/workflows/lib/text";
import { missingBrdSections } from "./doc/brd";
import { appendToSection, hasSection, replaceSectionBody, sectionBody, sectionHeadings } from "./doc/parse";
import type { DocResult, ReviseContext } from "./types";

interface Route {
  heading: string;
  level: number;
  mode: "paragraph" | "numbered" | "bullet" | "replace-if-missing" | "plan" | "question" | "decision" | "step";
}

const BRD_ROUTES: Array<[RegExp, Route]> = [
  // An explicit "add … as a requirement" wins over the topic words it contains ("confirmed", "legal").
  [/\b(as a (new )?requirement|new requirement|add (a )?requirement|requirement that)\b/i, { heading: "Requirements", level: 2, mode: "numbered" }],
  [/\b(lead|owner|sponsor|product manager|\bpm\b|stakeholder)\b/i, { heading: "Business and Product Lead", level: 2, mode: "replace-if-missing" }],
  [/\b(metric|kpi|baseline|measure|target)\b/i, { heading: "Success Metrics", level: 2, mode: "numbered" }],
  [/\b(out of scope|not in scope|exclude|drop|phase 2|later phase|not needed|defer)\b/i, { heading: "Out of Scope", level: 2, mode: "bullet" }],
  [/\b(comms|help center|training|kick-?off|launch readiness)\b/i, { heading: "Implementation Plan", level: 2, mode: "plan" }],
  [/\b(problem|pain|customer impact|impact)\b/i, { heading: "Problem to be Solved", level: 2, mode: "paragraph" }],
  // A figure about the current state ("18% of loyalty tickets were about expired points") is
  // evidence for the problem, not a capability.
  [/\d\s*%|\b\d[\d,]*\s+(tickets|calls|complaints|contacts|customers|orders)\b|\b(tickets|calls|complaints) (last|this|per|a|each)\b/i, { heading: "Problem to be Solved", level: 2, mode: "paragraph" }],
  [/\b(confirmed|decided|agreed|solution|host|surface|approach|reuse)\b/i, { heading: "Proposed Solution", level: 2, mode: "paragraph" }],
  [/\?\s*$/, { heading: "Open Questions", level: 2, mode: "question" }],
];

const AAD_ROUTES: Array<[RegExp, Route]> = [
  [/\b(decide|decided|decision|go with|choose|chose|chosen|confirmed|agreed)\b/i, { heading: "Logical view", level: 3, mode: "decision" }],
  [/\b(security|threat|pen ?test|dast|sast|okta|role|permission|access)\b/i, { heading: "Security", level: 2, mode: "paragraph" }],
  [/\b(test|qa|e2e|automation)\b/i, { heading: "Test Strategy", level: 2, mode: "paragraph" }],
  [/\b(deploy|rollout|roll out|flag|release|rollback|migration)\b/i, { heading: "Delivery/Deployment Strategy", level: 2, mode: "step" }],
  [/\b(monitor|alert|logging|dashboard|dynatrace)\b/i, { heading: "Monitoring and Observability", level: 2, mode: "paragraph" }],
  [/\b(data|schema|table|field|column|retention|pii|classification)\b/i, { heading: "Data Identification", level: 2, mode: "paragraph" }],
  [/\b(cost|estimate|budget|effort)\b/i, { heading: "Impact Analysis", level: 2, mode: "paragraph" }],
  [/\b(owner|owns|maintain|maintainer|team)\b/i, { heading: "Maintainers", level: 2, mode: "replace-if-missing" }],
  [/\b(out of scope|exclude|drop|defer|later phase)\b/i, { heading: "Out-of-scope", level: 2, mode: "bullet" }],
  [/\b(fr\d+|requirement)\b/i, { heading: "Requirement Details", level: 2, mode: "paragraph" }],
  [/\?\s*$/, { heading: "Appendix: Open Questions", level: 2, mode: "question" }],
];

/** An explicit "add … as a requirement" (the PO confirms it) rather than a sentence routed by default. */
const EXPLICIT_REQUIREMENT = BRD_ROUTES[0]![0];

/** "Add a metric for X and move Y out of scope" -> ["Add a metric for X", "move Y out of scope"]. */
function instructions(sentence: string): string[] {
  return sentence
    .split(/;\s+|,?\s+(?:and|then)\s+(?=(?:also\s+)?(?:move|add|drop|remove|exclude|defer|include|mark|make|change|rename|replace|keep|list|note|clarify|put|state)\b)/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

function route(docType: "BRD" | "AAD", text: string): Route {
  for (const [rx, r] of docType === "BRD" ? BRD_ROUTES : AAD_ROUTES) if (rx.test(text)) return r;
  return docType === "BRD" ? { heading: "Requirements", level: 2, mode: "numbered" } : { heading: "Logical view", level: 3, mode: "paragraph" };
}

function sentenceWithCite(text: string, cite: string): string {
  return `${text.trim().replace(/[.\s]+$/, "")} [${cite}].`;
}

/** Inserts a line after the last line of a section that matches `isItem`. */
function insertAfterLast(md: string, heading: string, level: number, isItem: (line: string) => boolean, line: string): string {
  const body = sectionBody(md, heading, level);
  if (body === undefined) return replaceSectionBody(md, heading, line, level);
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.trim() === `${"#".repeat(level)} ${heading}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s/.exec(lines[i] ?? "");
    if (m && (m[1]?.length ?? 7) <= level) {
      end = i;
      break;
    }
  }
  let last = -1;
  for (let i = start + 1; i < end; i++) if (isItem(lines[i] ?? "")) last = i;
  if (last < 0) return appendToSection(md, heading, line, level);
  return [...lines.slice(0, last + 1), line, ...lines.slice(last + 1)].join("\n");
}

function nextNumber(md: string, heading: string, level: number): number {
  const items = (sectionBody(md, heading, level) ?? "").split("\n").map((l) => /^\s*(\d+)\.\s/.exec(l)?.[1]).filter(Boolean);
  return items.length > 0 ? Math.max(...items.map(Number)) + 1 : 1;
}

function nextQuestion(md: string, heading: string): number {
  const ids = Array.from((sectionBody(md, heading) ?? "").matchAll(/^\|\s*Q(\d+)\s*\|/gm)).map((m) => Number(m[1]));
  return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

function short(text: string, max = 90): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

/** Drops the instruction wrapped around feedback ("add that …", "Out of scope: …") before it goes in the document. */
function asContent(r: Route, text: string): string {
  let t = text.trim();
  if (r.mode === "numbered" && r.heading === "Requirements") {
    t = t
      .replace(/[;,]?\s*(please\s+)?(add|include|list) (it|this|that) as a (new )?requirement\.?$/i, "")
      .replace(/^(please\s+)?(also\s+)?(add|include)\s+(a (new )?requirement\s+)?(that\s+|:\s*)?/i, "")
      // "Add X as a requirement." -> "X."
      .replace(/\s+as an? (new )?requirement(?=\.?$)/i, "")
      // "Legal confirmed on the call that X" -> "X (Legal confirmed this)".
      .replace(
        /^([A-Z][\w/&]*(?: [A-Z][\w/&]*)?) (confirmed|said|says|asked|wants|noted)(?: on the call| in the meeting| today)? that (.+)$/,
        (_m, who: string, verb: string, rest: string) => `${rest.replace(/[.\s]+$/, "")} (${who} ${verb} this)`,
      );
  }
  if (r.mode === "numbered" && r.heading === "Success Metrics") {
    // "Add a success metric for support-ticket reduction" -> "Support-ticket reduction".
    t = t.replace(/^(please\s+)?(also\s+)?(add|include|track|use)\s+(an?\s+|one\s+)?(new\s+)?(success\s+)?(metric|kpi|measure)s?\s*(for|on|about|of|:|that)?\s*/i, "").replace(/[.\s]+$/, "");
  }
  if (r.mode === "bullet") {
    t = t
      .replace(/^(please\s+)?(move|put|mark|take)\s+(.+?)\s+(out of scope|out of the scope|to out of scope|as out of scope|out of this release)\.?$/i, "$3")
      .replace(/\s+(is|are)\s+(now\s+)?(out of scope|not in scope)\.?$/i, "")
      .replace(/^(out of scope|not in scope|exclude|excluded|drop|defer)\s*[:\-–]?\s*/i, "");
  }
  t = t.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : text.trim();
}

/** Significant words of a phrase, in order ("SMS reminders" -> ["sms", "reminders"]). */
function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? []).filter((w) => w.length >= 3 && !isStopword(w));
}

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Takes a subject the PO moved out of scope out of the requirements that name it: "email and SMS
 * reminders" loses "SMS"; a requirement that is only about it is struck through, keeping its
 * number so traces stay valid. Returns the edited file and what changed.
 */
function takeOutOfRequirements(md: string, subject: string, cite: string, round: number): { md: string; moved: string[] } {
  const words = terms(subject);
  const key = words[0];
  if (!key || sectionBody(md, "Requirements") === undefined) return { md, moved: [] };
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.trim() === "## Requirements");
  const moved: string[] = [];
  const has = (text: string, w: string) => new RegExp(`\\b${escapeRx(w)}\\b`, "i").test(text);
  for (let i = start + 1; i < lines.length && !/^#{1,2}\s/.test(lines[i] ?? ""); i++) {
    const m = /^(\s*)(\d+)\.\s+(.*)$/.exec(lines[i] ?? "");
    if (!m || /^~~/.test(m[3] ?? "")) continue;
    const [, indent = "", n = "", body = ""] = m;
    const [text = "", cites = ""] = /^(.*?)(\s*\[[^\]]*\]\.?)?$/.exec(body)?.slice(1) ?? [body, ""];
    if (!has(text, key) || words.filter((w) => has(text, w)).length < Math.ceil(words.length / 2)) continue;
    const k = escapeRx(key);
    const dropped = text
      .replace(new RegExp(`(,\\s*|\\s+(?:and|or)\\s+|\\s*/\\s*)${k}\\b`, "i"), "")
      .replace(new RegExp(`^(.*?)\\b${k}(\\s*,\\s*|\\s+(?:and|or)\\s+|\\s*/\\s*)`, "i"), "$1");
    if (dropped !== text) {
      lines[i] = `${indent}${n}. ${dropped}${cites}`;
      moved.push(`removed "${new RegExp(`\\b${k}\\b`, "i").exec(text)?.[0] ?? key}" from requirement ${n}`);
    } else {
      lines[i] = `${indent}${n}. ~~${body.replace(/\s+$/, "")}~~ Moved to Out of Scope in round ${round} [${cite}].`;
      moved.push(`struck requirement ${n} (moved to Out of Scope; its number is kept)`);
    }
  }
  return { md: lines.join("\n"), moved };
}


function apply(md: string, r: Route, raw: string, cite: string, round: number, confirmed: boolean): { md: string; what: string } {
  const text = asContent(r, raw);
  const line = sentenceWithCite(text, cite);
  switch (r.mode) {
    case "numbered": {
      const n = nextNumber(md, r.heading, r.level);
      if (r.heading === "Success Metrics") {
        return { md: insertAfterLast(md, r.heading, r.level, (l) => /^\s*\d+\.\s/.test(l), `${n}. (Candidate) ${line} Baseline not provided.`), what: `added candidate metric ${n}` };
      }
      // Appended after the last item (candidates included), so existing BR numbers and traces stay valid.
      const kept = r.heading === "Requirements" && n > 1 ? " (existing numbers kept, so traces stay valid)" : "";
      if (r.heading === "Requirements" && !confirmed) {
        // Nobody confirmed it: a note or a stray sentence becomes a candidate for the PO to confirm.
        return { md: insertAfterLast(md, r.heading, r.level, (l) => /^\s*\d+\.\s/.test(l), `${n}. (Candidate) ${line}`), what: `added candidate requirement ${n}${kept}` };
      }
      if (r.heading === "Requirements" && /candidate requirements/i.test(sectionBody(md, r.heading, r.level) ?? "") && !/^Confirmed by the PO at review/m.test(sectionBody(md, r.heading, r.level) ?? "")) {
        // The last items are candidates: a confirmed addition gets its own line so it does not read as one.
        const intro = `Confirmed by the PO at review (round ${round - 1}):`;
        const withIntro = insertAfterLast(md, r.heading, r.level, (l) => /^\s*\d+\.\s/.test(l), `\n${intro}\n`);
        return { md: appendToSection(withIntro, r.heading, `${n}. ${line}`, r.level), what: `added confirmed requirement ${n}${kept}` };
      }
      return { md: insertAfterLast(md, r.heading, r.level, (l) => /^\s*\d+\.\s/.test(l), `${n}. ${line}`), what: `added ${r.heading === "Requirements" ? "confirmed requirement" : "item"} ${n}${kept}` };
    }
    case "step": {
      const n = nextNumber(md, r.heading, r.level);
      return { md: insertAfterLast(md, r.heading, r.level, (l) => /^\s*\d+\.\s/.test(l), `${n}. ${line}`), what: `added step ${n}` };
    }
    case "bullet": {
      // "Move SMS reminders out of scope" also takes them out of the requirements that name them.
      const out = r.heading === "Out of Scope" ? takeOutOfRequirements(md, text, cite, round) : { md, moved: [] };
      const next = insertAfterLast(out.md, r.heading, r.level, (l) => /^\s*-\s/.test(l), `- ${line}`);
      return { md: next, what: `added an exclusion${out.moved.length ? `; ${out.moved.join("; ")}` : ""}` };
    }
    case "replace-if-missing": {
      const body = sectionBody(md, r.heading, r.level) ?? "";
      if (body.startsWith("Not yet provided.")) return { md: replaceSectionBody(md, r.heading, line, r.level), what: "filled the section, which was not yet provided" };
      return { md: appendToSection(md, r.heading, line, r.level), what: "added a paragraph" };
    }
    case "plan": {
      const lines = md.split("\n");
      const words = keywords(text, 3);
      const i = lines.findIndex((l) => /^\s*\d+\.\s/.test(l) && words.some((w) => l.toLowerCase().includes(w)) && l.includes("Not yet provided."));
      if (i >= 0) {
        lines[i] = (lines[i] ?? "").replace(/—\s*Not yet provided\..*$/, `— ${line}`);
        return { md: lines.join("\n"), what: "updated a checklist item" };
      }
      return { md: appendToSection(md, r.heading, line, r.level), what: "added a note" };
    }
    case "question": {
      const n = nextQuestion(md, r.heading);
      const row = `| Q${n} | ${cell(line)} | ${/legal|consent/i.test(text) ? "Legal" : "PO"} |`;
      return { md: insertAfterLast(md, r.heading, r.level, (l) => /^\|\s*Q\d+\s*\|/.test(l), row), what: `added question Q${n}` };
    }
    case "decision":
      return { md: appendToSection(md, r.heading, `**Decision (round ${round}):** ${line}`, r.level), what: "recorded a decision" };
    default:
      return { md: appendToSection(md, r.heading, line, r.level), what: "added a paragraph" };
  }
}

/** Marks "Qn" rows answered by a sentence that names them. */
function markAnswered(md: string, heading: string, ids: number[], text: string, cite: string, round: number): string {
  let out = md;
  for (const id of ids) {
    out = out.replace(new RegExp(`^(\\|\\s*Q${id}\\s*\\|\\s*)([^|]*?)(\\s*\\|.*)$`, "m"), (_m, a: string, q: string, rest: string) => `${a}${q} **Answered in round ${round}:** ${cell(sentenceWithCite(text, cite))}${rest}`);
  }
  return out;
}

function addSourceRows(md: string, heading: string, rows: string[]): string {
  if (rows.length === 0 || !hasSection(md, heading)) return md;
  return rows.reduce((acc, row) => insertAfterLast(acc, heading, 2, (l) => /^\|\s*[A-Z]+\d*\s*\|/.test(l), row), md);
}

function addRevisionRow(md: string, text: string, date: string): string {
  if (!hasSection(md, "Document Revision")) return md;
  return insertAfterLast(md, "Document Revision", 2, (l) => /^\|/.test(l) && !/^\|\s*-/.test(l), `| *(architect to complete)* | ${date} | ${cell(text)} |`);
}

/** Changed top-level sections between the agent's last file and the current one. */
function editedSections(before: string, after: string): string[] {
  if (before === after) return [];
  const heads = [...new Set([...sectionHeadings(before), ...sectionHeadings(after)])];
  const changed = heads.filter((h) => (sectionBody(before, h) ?? "") !== (sectionBody(after, h) ?? ""));
  return changed.length > 0 ? changed : ["the title or status line"];
}

function overlap(a: string, b: string): number {
  const bw = new Set(keywords(b, 20));
  return keywords(a, 20).filter((w) => bw.has(w)).length;
}

export function reviseDocument(ctx: ReviseContext): DocResult<DraftReport | AadReport> {
  const isAad = ctx.docType === "AAD";
  const owner = isAad ? "architect" : "PO";
  const prevRound = ctx.round - 1;
  const feedbackCite = `${isAad ? "architect" : "PO"} feedback, round ${prevRound}`;
  const changes: string[] = [];
  const touched = new Set<string>();
  const answered = new Set<number>();
  let md = ctx.current;
  let decisionsNeeded = isAad ? [...((ctx.previousReport as AadReport).decisionsNeeded ?? [])] : [];

  const edited = editedSections(ctx.lastAgent, ctx.current);
  changes.push(
    `Revised ${ctx.out} in round ${ctx.round} from the current file${edited.length > 0 ? `, which includes the ${owner}'s own edits` : ""}; changed only the sections the feedback and new notes affect.`,
  );
  if (edited.length > 0) changes.push(`Kept the ${owner}'s edits to §${edited.join(", §")}; they take precedence over the notes and were not rewritten.`);

  const inputs: Array<{ text: string; cite: string; feedback?: boolean }> = [
    ...sentences(ctx.feedback)
      .flatMap(instructions)
      .map((text) => ({ text, cite: feedbackCite, feedback: true })),
    ...ctx.newNotes.flatMap((n) =>
      n.path === "inline"
        ? sentences(n.content)
            .slice(0, 4)
            .map((text) => ({ text, cite: n.id }))
        : numberedLines(n.content)
            .filter((l) => !/^#/.test(l.text))
            .slice(0, 4)
            .map((l) => ({ text: l.text.replace(/^[-*]\s*/, ""), cite: `${n.id} L${l.n}` })),
    ),
  ];

  const qHeading = isAad ? "Appendix: Open Questions" : "Open Questions";
  for (const { text, cite, feedback } of inputs) {
    const qids = Array.from(text.matchAll(/\bQ(\d+)\b/g)).map((m) => Number(m[1]));
    if (qids.length > 0 && !/\?\s*$/.test(text)) {
      md = markAnswered(md, qHeading, qids, text, cite, ctx.round);
      for (const q of qids) answered.add(q);
      changes.push(`§${qHeading}: marked ${qids.map((q) => `Q${q}`).join(", ")} answered from ${cite} — "${short(text)}".`);
      touched.add(qHeading);
      continue;
    }
    const r = route(ctx.docType, text);
    // Only the PO's own "add … as a requirement" confirms a requirement; anything else is a candidate.
    const result = apply(md, r, text, cite, ctx.round, !!feedback && EXPLICIT_REQUIREMENT.test(text));
    md = result.md;
    touched.add(r.heading);
    changes.push(`§${r.heading}: ${result.what} from ${cite} — "${short(text)}".`);
    if (r.mode === "decision" && decisionsNeeded.length > 0) {
      const best = decisionsNeeded.map((d, i) => ({ i, s: overlap(d, text) })).sort((a, b) => b.s - a.s)[0];
      if (best && best.s > 0) {
        changes.push(`Decision recorded, so "${short(decisionsNeeded[best.i] ?? "", 70)}" is no longer listed as needed.`);
        decisionsNeeded = decisionsNeeded.filter((_, i) => i !== best.i);
      }
    }
  }
  if (inputs.length === 0) changes.push(`No feedback text or new notes were given; the file is unchanged apart from the ${owner}'s edits.`);

  const date = isoDate(ctx.now);
  const origin = isAad ? "Architect" : "Product Owner";
  const newRows = ctx.newNotes.map(
    (n) => `| ${n.id} | ${n.type} | ${origin} | ${date} (supplied at review round ${prevRound}) | ${n.path === "inline" ? "Inline note text" : `\`${n.path}\``} |`,
  );
  md = addSourceRows(md, isAad ? "Appendix: Sources" : "Sources", newRows);
  if (newRows.length > 0) changes.push(`Sources appendix: added ${ctx.newNotes.map((n) => n.id).join(", ")}.`);
  if (isAad) md = addRevisionRow(md, `Round ${ctx.round} revision after architect feedback: ${short(ctx.feedback || "new notes only", 120)}`, date);

  const prev = ctx.previousReport;
  const notAnswered = (item: string) => !Array.from(item.matchAll(/\bQ(\d+)\b/g)).some((m) => answered.has(Number(m[1])));
  const blockingQuestions = prev.blockingQuestions.filter((q) => {
    const id = /^Q(\d+)\b/.exec(q)?.[1];
    return !(id && answered.has(Number(id)));
  });
  if (blockingQuestions.length < prev.blockingQuestions.length) {
    changes.push(`${prev.blockingQuestions.length - blockingQuestions.length} blocking question${prev.blockingQuestions.length - blockingQuestions.length === 1 ? "" : "s"} resolved by the feedback.`);
  }
  const heading = (entry: string) => entry.split(" — ")[0]?.split(" / ")[0]?.trim() ?? entry;
  const recomputed = isAad ? [] : missingBrdSections(md);
  const missingSections = [
    ...recomputed,
    ...prev.missingSections.filter((m) => !touched.has(heading(m)) && !recomputed.some((x) => heading(x) === heading(m))),
  ];
  const newInstructions = ctx.newNotes.flatMap((n) =>
    numberedLines(n.content)
      .filter((l) => /\b(agent|assistant|ai)\b[^.]*\b(mark|approve|email|send|publish|share)\b/i.test(l.text))
      .map((l) => `${n.id} L${l.n} — an instruction addressed to the agent ("${short(l.text, 80)}"); not acted on.`),
  );
  const base: DraftReport = {
    path: ctx.out,
    missingSections,
    blockingQuestions,
    conflicts: prev.conflicts.filter(notAnswered),
    ignoredInstructions: [...prev.ignoredInstructions, ...newInstructions],
    changes,
  };
  if (!isAad) return { content: md, report: base };
  const prevAad = prev as AadReport;
  const untraced = prevAad.untracedRequirements.filter((u) => {
    const n = /requirement (\d+)/i.exec(u)?.[1];
    return !(n && inputs.some((i) => new RegExp(`\\b(requirement|FR)\\s*${n}\\b`, "i").test(i.text)));
  });
  return { content: md, report: { ...base, untracedRequirements: untraced, decisionsNeeded } };
}
