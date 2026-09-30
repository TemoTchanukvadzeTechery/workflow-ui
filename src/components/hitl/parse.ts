/**
 * Readers for the structured text inside human requests. Workflows put the facts a form needs in
 * the question and detail strings (see src/lib/weft/workflows.ts for each format); these parse
 * them back without ever changing what is shown, since the question is always rendered verbatim.
 */

export interface DependencyRow {
  ref: string;
  kind: "jira" | "confluence" | string;
  relation: string;
  title: string;
  why: string;
  notFetched: boolean;
}

const DEP_LINE = /^- (\S+) \[([^,\]]+),\s*([^\]]+)\] (.*?)(?: \(content not fetched\))?\s*$/;

/**
 * Dependency rows from a `deps:review:<pass>` detail:
 * `- <ref> [<kind>, <relation>] <title>[ (content not fetched)]\n  <why>` or `- none found`.
 * Older runs put the same list in the question after a blank line; pass the question as a fallback.
 */
export function parseDependencyDetail(detail: string | undefined, question?: string): DependencyRow[] {
  const source = detail ?? (question && question.includes("\n- ") ? question.slice(question.indexOf("\n- ") + 1) : "");
  const rows: DependencyRow[] = [];
  let row: DependencyRow | null = null;
  for (const line of source.split("\n")) {
    const m = DEP_LINE.exec(line);
    if (m?.[1]) {
      row = { ref: m[1], kind: (m[2] ?? "").trim(), relation: (m[3] ?? "").trim(), title: (m[4] ?? "").trim(), why: "", notFetched: / \(content not fetched\)\s*$/.test(line) };
      rows.push(row);
    } else if (row && /^\s+\S/.test(line)) {
      row.why = row.why ? `${row.why} ${line.trim()}` : line.trim();
    } else if (line.trim() !== "") {
      row = null;
    }
  }
  return rows;
}

/** The number at the end of a key: "deps:review:2" -> 2, "task:review:1" -> 1. */
export function keyNumber(key: string | undefined): number | undefined {
  const m = key ? /:(\d+)$/.exec(key) : null;
  return m?.[1] ? Number(m[1]) : undefined;
}

export interface MemoryQuestionFacts {
  major: boolean;
  rebased: boolean;
  changes?: number;
  doc?: string;
}

/** `${rebased}${Major|Minor} update to the shared memory from this ${doc} (${n} changes; see the diff)…` */
export function parseMemoryQuestion(question: string): MemoryQuestionFacts {
  const changes = /\((\d+) changes?/.exec(question);
  const doc = /from this (\w+)/.exec(question);
  return {
    major: /\bMajor\b/.test(question),
    rebased: /^Rebased onto a newer memory file/.test(question),
    ...(changes?.[1] ? { changes: Number(changes[1]) } : {}),
    ...(doc?.[1] ? { doc: doc[1] } : {}),
  };
}

export interface TaskQuestionFacts {
  escalated: boolean;
  taskKey?: string;
  title?: string;
  passed?: number;
  checks?: number;
  adds?: number;
  dels?: number;
  files?: number;
}

/** `[Escalated: ]Review ${taskKey}: ${title} (${passed}/${checks} checks passed, +${adds} −${dels} in ${files} files). …` */
export function parseTaskQuestion(question: string): TaskQuestionFacts {
  const escalated = /^Escalated:/.test(question);
  const head = /Review (\S+): (.*?) \((\d+)\/(\d+) checks passed, \+(\d+) [−-](\d+) in (\d+) files?\)/.exec(question);
  if (!head) return { escalated };
  return {
    escalated,
    taskKey: head[1],
    title: head[2],
    passed: Number(head[3]),
    checks: Number(head[4]),
    adds: Number(head[5]),
    dels: Number(head[6]),
    files: Number(head[7]),
  };
}

export interface QaQuestionFacts {
  taskKey?: string;
  met?: number;
  total?: number;
  evidence?: number;
  automated?: number;
  manual?: number;
}

/** `QA ${taskKey}: ${met}/${total} acceptance criteria met, ${n} evidence items (${auto} automated, ${manual} manual). …` */
export function parseQaQuestion(question: string): QaQuestionFacts {
  const m = /QA (\S+): (\d+)\/(\d+) acceptance criteria met, (\d+) evidence items? \((\d+) automated, (\d+) manual\)/.exec(question);
  if (!m) return {};
  return { taskKey: m[1], met: Number(m[2]), total: Number(m[3]), evidence: Number(m[4]), automated: Number(m[5]), manual: Number(m[6]) };
}

export interface PlanQuestionFacts {
  round?: number;
  tasks?: number;
  waves?: number;
  openQuestions?: number;
}

/** `Round ${round}: review the implementation plan (${tasks} tasks in ${waves} waves, ${openQuestions} open questions). …` */
export function parsePlanQuestion(question: string): PlanQuestionFacts {
  const m = /Round (\d+): review the implementation plan \((\d+) tasks? in (\d+) waves?, (\d+) open questions?\)/.exec(question);
  if (!m) return {};
  return { round: Number(m[1]), tasks: Number(m[2]), waves: Number(m[3]), openQuestions: Number(m[4]) };
}

export interface DocQuestionFacts {
  round?: number;
  doc?: string;
  blockingQuestions?: number;
  conflicts?: number;
  decisionsNeeded?: number;
}

/** `Round ${round}: review the ${BRD|AAD} (${n} blocking questions, ${m} conflicts|decisions needed; see the draft report). …` */
export function parseDocQuestion(question: string): DocQuestionFacts {
  const m = /Round (\d+): review the (\w+)(?: \((\d+) blocking questions?, (\d+) (conflicts?|decisions? needed))?/.exec(question);
  if (!m) return {};
  const second = m[4] !== undefined ? Number(m[4]) : undefined;
  const isDecisions = !!m[5]?.startsWith("decision");
  return {
    round: Number(m[1]),
    doc: m[2],
    ...(m[3] !== undefined ? { blockingQuestions: Number(m[3]) } : {}),
    ...(second !== undefined ? (isDecisions ? { decisionsNeeded: second } : { conflicts: second }) : {}),
  };
}

/** "- <kind>: <summary>" items of the memory "changes" attachment. */
export function parseChangeItem(item: string): { kind?: string; summary: string } {
  const m = /^([a-z]+):\s+([\s\S]*)$/.exec(item.trim());
  return m?.[1] ? { kind: m[1], summary: m[2] ?? "" } : { summary: item.trim() };
}

/** A pasted note that is one token without whitespace is treated by po-brd as a file path. */
export function looksLikeSingleToken(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && !/\s/.test(t);
}
