import "server-only";
/**
 * The planner for any project without a hand-written pack: 1-3 tasks per epic, one per repo the
 * epic's systems name (a fallback set when none do), layered into waves (contracts and services,
 * then gateway and UI, then E2E), with acceptance criteria phrased from the BRD requirement texts
 * the epic traces to. Every AAD system marked Proposed or changed gets a task; one that maps to no
 * repository is listed under "Uncovered systems".
 */
import { requirementText } from "@/server/mock/workflows/delivery-lib/docs";
import { clip, lowerFirst, uniq } from "@/server/mock/workflows/delivery-lib/util";
import { repoKind, type RepoKind } from "./templates/repos";
import type { PlanContext, PlanPack, PlanTaskSeed } from "./types";

const KNOWN_REPOS = ["website-customer-portal", "customer-service-v2", "api-gateway", "api-contracts", "pww-automation", "website-myaccount", "terraform-auth0"];
const FALLBACKS = [
  ["customer-service-v2", "website-customer-portal"],
  ["website-customer-portal"],
  ["customer-service-v2", "api-gateway"],
];
/** AAD system rows that change something ("Proposed", "Changed", …), not "No change" / "not used". */
export function changedSystems(docs: PlanContext["docs"]): string[] {
  return docs.systems.filter((s) => !/no change|not used|unchanged|read-only/i.test(s.change)).map((s) => s.system);
}

const LAYER: Record<RepoKind, number> = { contracts: 1, java: 1, gateway: 2, angular: 2, auth0: 2, e2e: 3 };
const PART: Record<RepoKind, string> = { contracts: "contract", java: "service", gateway: "gateway", angular: "user-facing", auth0: "login-flow (Auth0 action)", e2e: "E2E" };

/** Repositories an AAD system name points at ("api-gateway (Proposed)" -> api-gateway). */
export function reposOf(systems: readonly string[]): string[] {
  const found: string[] = [];
  for (const s of systems) {
    const lower = s.toLowerCase();
    const known = KNOWN_REPOS.find((r) => lower.includes(r));
    if (known) found.push(known);
    // The Auth0 terms gate and other login actions live in terraform-auth0.
    else if (lower.includes("auth0")) found.push("terraform-auth0");
    else if (/\bmy ?account\b/.test(lower)) found.push("website-myaccount");
    else {
      const m = /\b(website-[a-z0-9-]+|[a-z0-9-]+-service(?:-v\d)?)\b/.exec(lower);
      if (m) found.push(m[1]);
    }
  }
  return uniq(found);
}

function isNonDev(title: string, systems: readonly string[]): boolean {
  if (/non-dev|launch readiness|comms|training/i.test(title)) return true;
  return systems.length > 0 && reposOf(systems).length === 0 && systems.every((s) => /plan|article|training|meeting|comms|kick-off/i.test(s));
}


function acsFor(kind: RepoKind, reqTexts: string[], epicTitle: string): Array<{ id: string; text: string }> {
  const texts: string[] = [];
  for (const t of reqTexts.slice(0, kind === "gateway" || kind === "contracts" ? 1 : 3)) {
    const body = clip(t.replace(/\.$/, ""), 150);
    if (kind === "java") texts.push(`The API returns what is needed so that ${lowerFirst(body)}`);
    else if (kind === "contracts") texts.push(`The contract covers the data needed so that ${lowerFirst(body)}`);
    else if (kind === "gateway") texts.push(`Authenticated portal requests for ${clip(epicTitle, 60)} reach the owning service unchanged`);
    else if (kind === "e2e") texts.push(`End to end: ${lowerFirst(body)}`);
    else if (kind === "auth0") texts.push(`At login, ${lowerFirst(body)}`);
    else texts.push(body);
  }
  const standard: Record<RepoKind, string> = {
    java: "Unit tests cover the new query and its edge cases (empty result, zero population)",
    angular: "Loading, empty and error states are shown; an error never shows partial data",
    gateway: "Requests without a valid Okta token get 401 and never reach the service",
    contracts: "The spec passes redocly lint with no breaking-change findings",
    e2e: "The suite runs green on internal-apps-test in the nightly job",
    auth0: "An error in the action never blocks a login; it is logged and the login continues",
  };
  texts.push(standard[kind]);
  if (texts.length < 2) texts.unshift(`Delivers ${clip(epicTitle, 80)} for its users`);
  return texts.slice(0, 4).map((text, i) => ({ id: `AC-${i + 1}`, text }));
}

function titleFor(kind: RepoKind, repo: string, epicTitle: string): string {
  const t = clip(epicTitle, 70);
  switch (kind) {
    case "java":
      return `[${repo}] ${t}: read endpoint`;
    case "contracts":
      return `[api-contracts] Contract for ${t}`;
    case "gateway":
      return `[api-gateway] Route for ${t}`;
    case "e2e":
      return `[QA] E2E: ${t}`;
    case "auth0":
      return `[terraform-auth0] ${t}: post-login action`;
    default:
      return `[${repo}] ${t}`;
  }
}

function sizeFor(kind: RepoKind, traces: number): PlanTaskSeed["size"] {
  if (kind === "contracts" || kind === "gateway") return traces > 3 ? "S" : "XS";
  if (traces >= 5) return "L";
  if (traces >= 2) return "M";
  return "S";
}

export function genericPlan(ctx: PlanContext): PlanPack {
  const epics = ctx.epics.length
    ? ctx.epics
    : [
        {
          id: "",
          key: null,
          title: ctx.docs.title,
          brdRequirementRefs: ctx.docs.requirements.filter((r) => !r.candidate).map((r) => r.id),
          aadRefs: ctx.docs.frs.map((f) => f.id),
          systems: ctx.docs.systems.filter((s) => !/no change|not used/i.test(s.change)).map((s) => s.system),
        },
      ];
  const drafts: Array<PlanTaskSeed & { epicIndex: number }> = [];
  const assumptions: string[] = [];
  const skipped: string[] = [];
  const uncoveredSystems: string[] = [];
  const draft = (i: number, epic: (typeof epics)[number], repo: string): PlanTaskSeed & { epicIndex: number } => {
    const kind = repoKind(repo);
    const traces = uniq([...epic.brdRequirementRefs, ...epic.aadRefs]).slice(0, 6);
    const reqTexts = epic.brdRequirementRefs.map((r) => requirementText(ctx.docs, r)).filter((t): t is string => Boolean(t));
    return {
      id: "",
      epicIndex: i,
      title: titleFor(kind, repo, epic.title),
      description: `${clip(epic.title, 90)}: the ${PART[kind]} part in ${repo}.${reqTexts[0] ? ` Driven by ${epic.brdRequirementRefs[0]}: ${clip(reqTexts[0], 140)}` : ""}`,
      priority: i === 0 ? "high" : "medium",
      tags: [kind === "angular" ? "frontend" : kind === "java" ? "backend" : kind === "auth0" ? "login" : kind],
      dependencies: [],
      relatedFiles: [],
      acceptanceCriteria: acsFor(kind, reqTexts, epic.title),
      epic: { title: epic.title, refs: traces },
      type: kind === "contracts" || kind === "gateway" ? "task" : "story",
      repo,
      size: sizeFor(kind, traces.length),
      wave: LAYER[kind],
      traces,
    };
  };

  epics.forEach((epic, i) => {
    if (isNonDev(epic.title, epic.systems)) {
      skipped.push(`${epic.key ?? epic.title}: ${epic.title} has no engineering work; tracked outside the plan`);
      return;
    }
    let repos = reposOf(epic.systems);
    if (repos.length === 0) {
      repos = FALLBACKS[i % FALLBACKS.length];
      assumptions.push(`"${clip(epic.title, 60)}" lists no repository; planned against ${repos.join(" and ")}.`);
    }
    repos = [...repos].sort((a, b) => LAYER[repoKind(a)] - LAYER[repoKind(b)]).slice(0, 3);
    for (const repo of repos) drafts.push(draft(i, epic, repo));
  });

  // Every system the AAD proposes to change gets a task, under the epic that names it, else the
  // first epic with service work (a gateway route or contract serves that service), else the first.
  const devEpics = epics.map((e, i) => ({ e, i })).filter(({ e }) => !isNonDev(e.title, e.systems));
  const extraAt = drafts.length;
  for (const system of changedSystems(ctx.docs)) {
    const repos = reposOf([system]);
    if (!repos.length) {
      if (!/plan|article|training|meeting|comms|kick-off/i.test(system)) uncoveredSystems.push(`${system}: Proposed or changed in the AAD, but no task works on it (it maps to no repository the planner knows); plan it by hand if it needs code`);
      continue;
    }
    for (const repo of repos) {
      if (drafts.some((d) => d.repo === repo) || !devEpics.length) continue;
      const home =
        devEpics.find(({ e }) => reposOf(e.systems).includes(repo)) ??
        devEpics.find(({ i }) => drafts.some((d) => d.epicIndex === i && repoKind(d.repo) === "java")) ??
        devEpics[0];
      drafts.push(draft(home.i, home.e, repo));
    }
  }
  for (const d of drafts.slice(extraAt)) assumptions.push(`${d.repo} is Proposed or changed in the AAD but no epic lists it; planned "${d.title}" under ${clip(d.epic.title, 60)}.`);

  // An E2E pass over every user-facing task closes the plan (and guarantees at least two waves).
  const ui = drafts.filter((d) => repoKind(d.repo) === "angular" || repoKind(d.repo) === "auth0");
  const services = drafts.filter((d) => repoKind(d.repo) === "java");
  if ((ui.length > 0 || services.length > 0) && !drafts.some((d) => repoKind(d.repo) === "e2e")) {
    const covered = uniq(drafts.flatMap((d) => d.traces.filter((t) => t.startsWith("BR")))).slice(0, 6);
    const lastWave = Math.max(...drafts.map((d) => d.wave));
    drafts.push({
      id: "",
      epicIndex: -1,
      title: `[QA] E2E: ${clip(ctx.docs.title, 70)}`,
      description: `pww-automation suite covering the ${ui.length ? "user-facing flows" : "service behavior"} of this plan on internal-apps-test.`,
      priority: "medium",
      tags: ["qa", "e2e"],
      dependencies: [],
      relatedFiles: [],
      acceptanceCriteria: [
        { id: "AC-1", text: "Each planned user flow has a passing scenario on internal-apps-test" },
        { id: "AC-2", text: "The suite runs green in the nightly job" },
      ],
      epic: { title: epics[0].title, refs: covered },
      type: "task",
      repo: "pww-automation",
      size: "S",
      wave: Math.min(3, Math.max(2, lastWave + 1)),
      traces: covered,
    });
  }

  drafts.sort((a, b) => a.wave - b.wave || a.epicIndex - b.epicIndex);
  drafts.forEach((d, i) => (d.id = `T-${i + 1}`));
  const closerDeps = (ui.length ? ui : services).map((o) => o.id);
  for (const d of drafts) {
    d.dependencies = d.epicIndex === -1 ? closerDeps : drafts.filter((o) => o.epicIndex === d.epicIndex && o.wave < d.wave).map((o) => o.id);
  }

  const tracedBr = new Set(drafts.flatMap((d) => d.traces));
  const uncovered = ctx.docs.requirements
    .filter((r) => !tracedBr.has(r.id))
    .map((r) => `${r.id}${r.candidate ? " (Candidate)" : ""}: ${clip(r.text, 110)}`)
    .concat(skipped);
  const waves = uniq(drafts.map((d) => d.wave)).length;

  return {
    summary: `${drafts.length} tasks in ${waves} waves across ${uniq(drafts.map((d) => d.repo)).join(", ")}, one to three per epic, ordered so contracts and services land before the gateway and UI work that depends on them${
      ui.length ? ", with an end-to-end suite last" : ""
    }. Acceptance criteria are phrased from the BRD requirements each epic traces to.`,
    tasks: drafts.map((d) => {
      const t: PlanTaskSeed & { epicIndex?: number } = { ...d };
      delete t.epicIndex;
      return t;
    }),
    report: {
      ...(uncoveredSystems.length ? { uncoveredSystems } : {}),
      assumptions: [
        ...assumptions,
        "Team Customer Guardians owns every task until a team is set per repo.",
        ctx.docs.frs.length ? "Design follows the accepted AAD's system changes." : "No functional requirements were found in an AAD; the plan follows the BRD and epics only.",
      ],
      openQuestions: ctx.docs.openQuestions.slice(0, 3),
      uncovered,
      risks: [
        ...(ui.length && !drafts.some((d) => d.title.toLowerCase().includes("flag"))
          ? ["No feature flag task: new UI ships visible unless a LaunchDarkly flag is added."]
          : []),
        "Estimates are sizes only (XS-L); confirm them at refinement before the first wave starts.",
      ],
    },
  };
}
