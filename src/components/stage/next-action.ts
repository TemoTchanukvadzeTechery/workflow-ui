/**
 * The project's next step (ProjectBundle.nextStep, e.g. "Developer: review CP-52204 · Row limit
 * …") as a control: the role split off for the overview card, a short button label for the gate
 * footer, and a way to reach the in-page control or request the step points at.
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

/**
 * A short label for a next step: the action without its role and trailing detail.
 * "Developer: review CP-52204 · Row limit …" → "Review CP-52204";
 * "Product Owner: the last po-brd run ended without acceptance — start another run" → "Start another run";
 * "Architect: AAD round 1 is waiting — 3 blocking questions" → "Review AAD round 1";
 * "Owner: qa-verify needs your input" → "Answer qa-verify".
 */
export function nextActionLabel(text: string): string {
  let action = splitRole(text).action;
  const [head, tail] = action.split(" — ");
  action = tail && VERB.test(tail) ? tail : head;
  action = action.split(" · ")[0];
  const waiting = /^(.+?) is waiting$/.exec(action);
  if (waiting) action = `Review ${waiting[1]}`;
  const input = /^(.+?) needs your input$/.exec(action);
  if (input) action = `Answer ${input[1]}`;
  return capitalize(action.trim());
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
