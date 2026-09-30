import "server-only";
/**
 * Minimal readers for the BRD and AAD formats in SPEC 4.2a, so the planner can phrase tasks and
 * acceptance criteria from the accepted documents rather than from canned text.
 */

export interface DocContext {
  title: string;
  requirements: Array<{ id: string; text: string; candidate: boolean }>;
  frs: Array<{ id: string; text: string; traces: string[]; designElement: string }>;
  systems: Array<{ system: string; change: string }>;
  openQuestions: string[];
}

function section(markdown: string, heading: RegExp): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return "";
  const level = (/^(#+)/.exec(lines[start])?.[1].length ?? 2);
  const end = lines.findIndex((l, i) => i > start && new RegExp(`^#{1,${level}}\\s`).test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** Removes trailing citation brackets like "[N1 L2, R2 Description]". */
function stripCitations(text: string): string {
  return text.replace(/\s*\[[^\]]*\]\s*/g, " ").replace(/\s+/g, " ").trim().replace(/\s+\./g, ".");
}

export function readDocs(brd: string | undefined, aad: string | undefined): DocContext {
  const b = brd ?? "";
  const a = aad ?? "";
  const title =
    /^#\s*BRD:\s*(.+)$/m.exec(b)?.[1].trim() ??
    /^#\s*Architecture Approach\s*-\s*(.+)$/m.exec(a)?.[1].trim() ??
    /^#\s+(.+)$/m.exec(b || a)?.[1].trim() ??
    "Untitled project";

  const requirements: DocContext["requirements"] = [];
  for (const line of section(b, /^##\s+Requirements\s*$/).split("\n")) {
    const m = /^\s*(\d+)\.\s+(.+)$/.exec(line);
    // A struck item ("~~text~~ Moved to Out of Scope …") is no longer a requirement.
    if (!m || m[2].startsWith("~~")) continue;
    const candidate = /\(Candidate\)/i.test(m[2]);
    requirements.push({ id: `BR-${m[1]}`, text: stripCitations(m[2].replace(/\(Candidate\)\s*/i, "")), candidate });
  }

  const frs: DocContext["frs"] = [];
  for (const line of section(a, /^###\s+Functional Requirements/).split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 5 || !/^FR\d+$/.test(cells[1])) continue;
    const traces = [...cells[3].matchAll(/§Requirements\s+(\d+)/g)].map((m) => `BR-${m[1]}`);
    frs.push({ id: cells[1], text: stripCitations(cells[2].replace(/\*/g, "")), traces, designElement: stripCitations(cells[4]) });
  }

  const systems: DocContext["systems"] = [];
  for (const line of section(a, /^###\s+High-Level Architecture/).split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 4 || !cells[1] || cells[1] === "System" || /^-+$/.test(cells[1])) continue;
    systems.push({ system: cells[1], change: stripCitations(cells[2].replace(/\*/g, "")) });
  }

  const openQuestions: string[] = [];
  for (const line of section(b, /^##\s+Open Questions/).split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length >= 4 && /^Q\d+$/.test(cells[1])) {
      openQuestions.push(`${cells[1]}: ${stripCitations(cells[2])}`);
      continue;
    }
    const m = /^\s*(?:[-*]|\d+\.)?\s*\**(Q\d+)\**[:.\s-]+(.+)$/.exec(line);
    if (m) openQuestions.push(`${m[1]}: ${stripCitations(m[2])}`);
  }

  return { title, requirements, frs, systems, openQuestions };
}

/** Joins a requirement id to its text, for acceptance-criteria phrasing. */
export function requirementText(ctx: DocContext, ref: string): string | undefined {
  return ctx.requirements.find((r) => r.id === ref)?.text ?? ctx.frs.find((f) => f.id === ref)?.text;
}
