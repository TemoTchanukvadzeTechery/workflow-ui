import "server-only";
/**
 * Renders a BRD in the po-brd SKILL.md template (section order, numbered Requirements with
 * "(Candidate)" items, Qn table, the five-item Implementation Plan, Sources appendix) and builds
 * the drafting agent's handoff report from the same spec, so the report always matches the file.
 */
import type { DraftReport } from "@/lib/delivery/types";
import { cell } from "@/server/mock/workflows/lib/text";
import type { DocResult } from "../types";
import { Cites } from "./cites";
import { numberedItems, sectionBody } from "./parse";

export interface QuestionSpec {
  text: string;
  who: string;
  /** Blocks the problem statement or scope; listed in the draft report. */
  blocking?: boolean;
  /** Wording for the draft report; defaults to the question text. */
  report?: string;
}

export interface BrdSpec {
  title: string;
  lead: string[];
  problem: string[];
  solution: string[];
  requirements: Array<{ text: string; candidate?: boolean }>;
  candidateIntro?: string;
  metrics: { intro: string; items: string[]; outro?: string };
  outOfScope: string[];
  outOfScopeNote?: string;
  questions: QuestionSpec[];
  planIntro?: string;
  /** Statuses for the five checklist items; default "Not yet provided.". */
  plan?: string[];
}

export interface BrdReportSpec {
  conflicts: string[];
  ignoredInstructions: string[];
  changes: string[];
  /** Extra "why" text for sections left "Not yet provided.", keyed by section heading. */
  missingWhy?: Record<string, string>;
}

export const BRD_SECTIONS = [
  "Business and Product Lead",
  "Problem to be Solved",
  "Proposed Solution",
  "Requirements",
  "Success Metrics",
  "Out of Scope",
  "Open Questions",
  "Implementation Plan",
  "Sources",
] as const;

export const PLAN_ITEMS = [
  "Comms Plan (emails, social posts, Jewel communication, VO news bulletin)",
  "Help Center Articles",
  "Internal Training",
  "Date of Pre Implementation Kick off Meeting",
  "Schedule launch readiness Meeting",
];

const NOT_YET = "Not yet provided.";

export function renderBrd(spec: BrdSpec, cites: Cites): string {
  const main = spec.requirements.filter((r) => !r.candidate);
  const candidates = spec.requirements.filter((r) => r.candidate);
  const reqLines = main.map((r, i) => `${i + 1}. ${r.text}`);
  const candLines = candidates.map((r, i) => `${main.length + i + 1}. ${/^\(Candidate\)/.test(r.text) ? r.text : `(Candidate) ${r.text}`}`);
  const plan = PLAN_ITEMS.map((item, i) => `${i + 1}. ${item} — ${spec.plan?.[i] ?? NOT_YET}`);

  const md = [
    `# BRD: ${spec.title}`,
    "",
    // Acceptance is recorded by the workflow, not in the file, so the line must stay true once accepted.
    "Status: written by the po-brd agent for Product Owner review; acceptance is recorded outside this file. It states requirements, not an approval or a commitment.",
    "",
    "## Business and Product Lead",
    "",
    spec.lead.join("\n\n"),
    "",
    "## Problem to be Solved",
    "",
    spec.problem.join("\n\n"),
    "",
    "## Proposed Solution",
    "",
    spec.solution.join("\n\n"),
    "",
    "## Requirements",
    "",
    reqLines.join("\n"),
    ...(candLines.length > 0
      ? ["", spec.candidateIntro ?? "The following are candidate requirements the sources support but the PO has not confirmed; confirm before including:", "", candLines.join("\n")]
      : []),
    "",
    "## Success Metrics",
    "",
    spec.metrics.intro,
    "",
    spec.metrics.items.map((m, i) => `${i + 1}. ${m}`).join("\n"),
    ...(spec.metrics.outro ? ["", spec.metrics.outro] : []),
    "",
    "## Out of Scope",
    "",
    spec.outOfScope.map((o) => `- ${o}`).join("\n"),
    ...(spec.outOfScopeNote ? ["", spec.outOfScopeNote] : []),
    "",
    "## Open Questions",
    "",
    "| # | Question | Who can answer |",
    "| --- | --- | --- |",
    ...spec.questions.map((q, i) => `| Q${i + 1} | ${cell(q.text)} | ${cell(q.who)} |`),
    "",
    "## Implementation Plan",
    "",
    spec.planIntro ?? "Status and dates only where the sources provide them.",
    "",
    plan.join("\n"),
    "",
    "## Sources",
    "",
    cites.brdSources(),
    "",
    "This appendix exists for traceability and can be removed before the BRD is circulated.",
    "",
  ].join("\n");
  return cites.resolve(md);
}

const DEFAULT_WHY: Record<string, string> = {
  "Business and Product Lead": "no source names the business stakeholder or Product Manager",
  "Success Metrics": "no source states a KPI or candidate metric",
};

/** "Section — why" for each template section whose body starts with "Not yet provided.". */
export function missingBrdSections(md: string, why: Record<string, string> = {}): string[] {
  const out: string[] = [];
  for (const heading of BRD_SECTIONS) {
    const body = sectionBody(md, heading);
    if (body === undefined) {
      out.push(`${heading} — section missing from the draft`);
      continue;
    }
    if (body.startsWith(NOT_YET)) out.push(`${heading} — ${why[heading] ?? DEFAULT_WHY[heading] ?? "no source provides it"}`);
  }
  const planItems = numberedItems(sectionBody(md, "Implementation Plan") ?? "");
  const open = planItems.filter((t) => t.includes(NOT_YET));
  if (planItems.length > 0 && open.length === planItems.length) {
    out.push(`Implementation Plan — all ${planItems.length === 5 ? "five" : planItems.length} checklist items are '${NOT_YET}'; no source gives status or dates`);
  } else if (open.length > 0) {
    out.push(`Implementation Plan — ${open.length} of ${planItems.length} checklist items are '${NOT_YET}'`);
  }
  return out;
}

/** Numbered question ids with the text the draft report uses. */
export function blockingQuestions(spec: { questions: QuestionSpec[] }, cites: Cites): string[] {
  return spec.questions.flatMap((q, i) => (q.blocking ? [cites.resolve(`Q${i + 1} — ${q.report ?? q.text}`)] : []));
}

export function draftBrd(spec: BrdSpec, report: BrdReportSpec, cites: Cites, out: string): DocResult<DraftReport> {
  const content = renderBrd(spec, cites);
  return {
    content,
    report: {
      path: out,
      missingSections: missingBrdSections(content, report.missingWhy),
      blockingQuestions: blockingQuestions(spec, cites),
      conflicts: report.conflicts.map((c) => cites.resolve(c)),
      ignoredInstructions: report.ignoredInstructions.map((c) => cites.resolve(c)),
      changes: report.changes.map((c) => cites.resolve(c)),
    },
  };
}
