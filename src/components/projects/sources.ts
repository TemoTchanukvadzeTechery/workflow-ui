/**
 * Requirement sources and intake validation. po-brd takes Jira keys and Confluence page ids as
 * `seeds`, and repo note files or inline note text as `notes`; nothing else is offered.
 */
import { DEFAULT_BRD_OPTIONS, type Intake, type RequirementSource, type RequirementSourceKind } from "@/lib/delivery/types";

export const SOURCE_KIND_LABEL: Record<RequirementSourceKind, string> = {
  jira: "Jira issue or epic",
  confluence: "Confluence page",
  "note-file": "Note file",
  "note-text": "Pasted note",
};

export const SOURCE_GROUP_LABEL: Record<RequirementSourceKind, string> = {
  jira: "Jira",
  confluence: "Confluence",
  "note-file": "Note files",
  "note-text": "Pasted notes",
};

export function mapsToOf(kind: RequirementSourceKind): RequirementSource["mapsTo"] {
  return kind === "jira" || kind === "confluence" ? "seeds" : "notes";
}

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return `src-${c?.randomUUID ? c.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)}`;
}

export function defaultSourceLabel(kind: RequirementSourceKind, value: string): string {
  if (kind === "confluence") return `Confluence page ${value}`;
  if (kind === "note-text") {
    const oneLine = value.replace(/\s+/g, " ").trim();
    return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
  }
  return value;
}

export function makeSource(kind: RequirementSourceKind, value: string, actorName: string, label?: string): RequirementSource {
  return {
    id: newId(),
    kind,
    label: label?.trim() || defaultSourceLabel(kind, value),
    value,
    mapsTo: mapsToOf(kind),
    addedBy: { kind: "human", name: actorName },
    addedAt: Date.now(),
  };
}

export interface IntakeFormValue {
  name: string;
  summary: string;
  intake: Intake;
}

export type IntakeErrors = Partial<Record<"name" | "request" | "options" | "form", string>>;

/** The exact po-brd validation message (the server answers 400 with it). */
export const REQUEST_OR_NOTES_ERROR = "Provide the PO's request text in request, or at least one note in notes.";

/** The same rule in the form's words, shown after a start attempt. */
export const REQUEST_OR_NOTES_HINT = "Describe the project, or add at least one note, before starting the run.";

export function emptyIntakeValue(): IntakeFormValue {
  return { name: "", summary: "", intake: { request: "", sources: [], options: { ...DEFAULT_BRD_OPTIONS } } };
}

/**
 * Errors to show before saving or starting. `requireName` is off for the Stage 1 page, where
 * the name lives in the project header. A saved draft needs only a name.
 */
export function validateIntake(value: IntakeFormValue, opts: { forRun?: boolean; requireName?: boolean } = {}): IntakeErrors {
  const errors: IntakeErrors = {};
  if ((opts.requireName ?? true) && !value.name.trim()) errors.name = "Give the project a name.";
  const notes = value.intake.sources.filter((s) => s.mapsTo === "notes");
  if (opts.forRun && !value.intake.request.trim() && notes.length === 0) errors.request = REQUEST_OR_NOTES_HINT;
  const o = value.intake.options;
  const inRange = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (!inRange(o.maxRounds, 1, 5) || !inRange(o.discoveryRounds, 1, 5) || !inRange(o.maxQueries, 1, 10)) {
    errors.options = "Review rounds and discovery rounds are 1 to 5; searches per round are 1 to 10.";
  } else if (o.budget !== undefined && o.budget.trim() !== "" && !/^(\$\d+(\.\d+)?|\d+(\.\d+)?[km]?)(,\s*(\$\d+(\.\d+)?|\d+(\.\d+)?[km]?))?$/i.test(o.budget.trim())) {
    errors.options = 'Budget looks like "$8", "500k" or "500k,$8".';
  }
  return errors;
}

/** "Reorder Reminders!" -> "reorder-reminders". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * How a dependency's relation and "why" read on screen. The workflows mirror po-brd's
 * lib/discover.ts, which labels every seed "named by the PO" and review additions "added by the
 * PO". Seeds are the run's sources plus every ref found in the request and notes (and, for
 * architect-aad, the BRD), and with no roles those words name the wrong person, so only the
 * display changes here.
 */
export function relationText(relation: string): string {
  const r = relation.trim().toLowerCase();
  if (r === "named by the po") return "named in the inputs";
  if (r === "added by the po") return "added during review";
  return relation;
}

export function dependencyWhyText(relation: string, why: string | undefined, workflow?: string): string | undefined {
  if (!why) return why;
  const r = relation.trim().toLowerCase();
  if (r === "named by the po" && /^The PO supplied this reference/i.test(why)) return workflow === "architect-aad" ? "Named in the BRD, the request, the notes or the sources" : "Named in the request, the notes or the sources";
  if (r === "added by the po" && /^The PO added this reference/i.test(why)) return "Added in the dependency review";
  return why;
}
