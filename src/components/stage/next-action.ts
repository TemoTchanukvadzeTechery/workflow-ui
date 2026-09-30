/**
 * The project's next step (ProjectBundle.nextStep, e.g. "Developer: review CP-52204 · Row limit
 * …") as a control: the role split off for the overview card, a short button label (28 characters at
 * most) for the gate footer, and a way to reach the in-page control or request the step points at.
 */
import { parseRequestParam } from "@/hooks/use-stage-params";
import { requestDomId } from "../hitl/HumanRequestCard";

/** "Developer: review CP-52153 · …" → role "Developer", action "Review CP-52153 · …". */
export function splitRole(text: string): { role?: string; action: string } {
  const m = /^(Product Owner|Architect|Developer|QA|Demo user|[A-Z][\w ]{1,24}):\s+(.+)$/s.exec(text);
  if (!m) return { action: capitalize(text) };
  return { role: m[1], action: capitalize(m[2]) };
}

const VERB = /^(start|review|answer|accept|approve|confirm|generate|run|resolve|add|unblock|open|sign)\b/i;

/** The gate footer's primary button stays a short verb phrase; the full text goes in its title. */
export const ACTION_LABEL_MAX = 28;

/** Wordy objects shortened for a button: "confirm the dependencies found for the BRD" → "Confirm dependencies". */
const SHORTER: ReadonlyArray<[RegExp, string]> = [
  [/^confirm the dependencies\b.*$/i, "Confirm dependencies"],
  [/^review the memory update\b.*$/i, "Review memory update"],
  [/^review the implementation plan \(round (\d+)\)$/i, "Review plan round $1"],
  [/^review the implementation plan\b.*$/i, "Review the plan"],
  [/^generate it again$/i, "Generate the plan again"],
  [/^accept the epic updates\b.*$/i, "Accept epic updates"],
  [/^resolve requirements without evidence\b.*$/i, "Resolve requirement gaps"],
  [/^review (\d+) code and memory changes?$/i, "Review $1 changes"],
  [/^approve (.+?) and move to .+$/i, "Approve $1"],
];

/** Cut to at most `max` characters at a word boundary, with an ellipsis when anything was cut. */
function clip(text: string, max = ACTION_LABEL_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:·-]+$/, "")}…`;
}

/**
 * A short label (28 characters at most) for a next step: the action without its role, trailing
 * detail, parentheses or articles.
 * "Developer: review CP-52204 · Row limit …" → "Review CP-52204";
 * "Product Owner: confirm the dependencies found for the BRD (pass 1)" → "Confirm dependencies";
 * "Product Owner: the last po-brd run ended without acceptance — start another run" → "Start another run";
 * "Architect: AAD round 1 is waiting — 3 blocking questions" → "Review AAD round 1";
 * "Owner: qa-verify needs your input" → "Answer qa-verify".
 */
export function nextActionLabel(text: string): string {
  let action = splitRole(text).action;
  const [head, tail] = action.split(" — ");
  action = tail && VERB.test(tail) ? tail : head;
  action = action.split(" · ")[0].trim();
  const pending = /^(\d+) pending (requests?)\b/.exec(action);
  const waiting = /^(.+?) is waiting$/.exec(action);
  const input = /^(.+?) needs your input$/.exec(action);
  if (pending) action = `Answer ${pending[1]} pending ${pending[2]}`;
  else if (waiting) action = `Review ${uncapitalize(waiting[1])}`;
  else if (input) action = `Answer ${uncapitalize(input[1])}`;
  else if (!VERB.test(action)) action = blockerLabel(action) ?? action;
  const short = SHORTER.find(([re]) => re.test(action));
  if (short) action = action.replace(short[0], short[1]);
  if (action.length > ACTION_LABEL_MAX) action = action.replace(/\s*\([^)]*\)\s*$/, "");
  // "Unblock CP-52201, CP-52202, CP-52203" → "Unblock 3 tasks".
  const ids = /^(\w+) ([A-Z][A-Z0-9]*-\d+(?:, [A-Z][A-Z0-9]*-\d+)+)$/.exec(action);
  if (action.length > ACTION_LABEL_MAX && ids) action = `${ids[1]} ${ids[2].split(", ").length} tasks`;
  if (action.length > ACTION_LABEL_MAX) action = action.replace(/\b(the|a|an) /gi, "");
  return clip(capitalize(action.trim()));
}

/** Blocker text → a short control label for the gate, when the blocker (not a next step) is the primary control. */
const BLOCKER_ACTION: ReadonlyArray<[RegExp, string]> = [
  [/^The (BRD|AAD) is not accepted yet$/, "Review the $1"],
  [/^No epics yet/, "Add an epic"],
  [/^Epic updates from the AAD/, "Accept epic updates"],
  [/epics? not accepted yet$/, "Review proposed epics"],
  [/^The implementation plan is not approved/, "Review the plan"],
  [/^The plan has no tasks$/, "Open the plan"],
  [/tasks? not done:/, "Open unfinished tasks"],
  [/^No tasks to certify$/, "Open tasks"],
  [/tasks? not certified:/, "Open uncertified tasks"],
  [/requirements? not met or waived:/, "Open traceability"],
  [/change reviews? pending$/, "Review changes"],
  [/^(.+) is not approved$/, "Go to $1"],
];

function blockerLabel(text: string): string | undefined {
  for (const [re, to] of BLOCKER_ACTION) {
    const m = re.exec(text);
    if (m) return clip(to.replace(/\$(\d)/g, (_, i: string) => m[Number(i)] ?? ""));
  }
  return undefined;
}

/** "2 of 5 tasks not certified: T-2 (CP-52202), …" → "Open uncertified tasks"; unknown blockers → "Resolve the blocker". */
export function blockerActionLabel(text: string): string {
  return blockerLabel(text) ?? "Resolve the blocker";
}

/** Lowercase words without articles or punctuation: "Start the requirements run" ≈ "Start requirements run". */
export function labelKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * After a same-page navigation to `href`, bring what it points at into view: the request card
 * for ?request=, else an enabled button or link in the stage workspace whose label matches
 * `label`, else the top of the workspace. The stage view re-renders for the new ?step= /
 * ?request= first, so this looks for the target for a moment before giving up.
 */
export function revealTarget(href: string, label?: string): void {
  const url = new URL(href, window.location.href);
  const request = parseRequestParam(url.searchParams.get("request"));
  const key = label ? labelKey(label) : "";
  const workspace = () => document.querySelector<HTMLElement>("[data-stage-workspace]");
  const find = (): HTMLElement | null => {
    if (request) return document.getElementById(requestDomId(request.runId, request.requestId));
    if (!key) return null;
    const controls = workspace()?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]") ?? [];
    return [...controls].find((el) => labelKey(el.textContent ?? "") === key) ?? null;
  };
  let tries = 0;
  const tick = () => {
    const el = find();
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: request ? "start" : "center" });
      if (!request) el.focus({ preventScroll: true });
      return;
    }
    if (++tries < 12) window.setTimeout(tick, 100);
    else workspace()?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  window.setTimeout(tick, 60);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Undo splitRole's capital on a lowercase name ("Qa-verify" → "qa-verify"), keeping acronyms ("AAD round 1"). */
function uncapitalize(s: string): string {
  return /^[A-Z][a-z0-9-]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
