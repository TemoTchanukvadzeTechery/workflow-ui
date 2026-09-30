import "server-only";
/**
 * Mock epic logic [SPEC]: no weft workflow writes to Jira today, so epics are proposed here from
 * the accepted BRD (related requirements grouped into 3–5 epics, candidates parked behind their
 * open question) and updated from the accepted AAD (FR refs, design elements, systems).
 */
import type { AadRequirement, BrdRequirement, Epic, EpicHistoryEntry } from "@/lib/delivery/types";
import { questionRefs, type SystemChange } from "./parse";
import { shorten, uniq } from "./util";

export interface EpicProposal {
  title: string;
  objective: string;
  context: string;
  inScope: string[];
  brdRequirementRefs: string[];
  blockedBy?: string[];
}

/** A hand-curated epic for a seeded project; `architecture` pins what the AAD update sets. */
export interface CuratedEpic extends EpicProposal {
  architecture?: { systems?: string[]; blockedBy?: string[] };
}

const THEMES: Array<{ re: RegExp; title: string; objective: string }> = [
  {
    re: /\b(access|restrict|role|permission|authori[sz]|audience|okta|sign[- ]?in|log[- ]?in)/i,
    title: "Access control and rollout",
    objective: "Limit the new capability to its intended audience and roll it out safely behind a flag.",
  },
  { re: /\b(filter|segment|search|sort|group by)/i, title: "Filters and segmentation", objective: "Let users narrow the figures to the slice they need." },
  {
    re: /\b(preferen|opt[- ]?out|opt[- ]?in|snooze|turn (it )?off|unsubscrib|consent)/i,
    title: "Preferences and consent",
    objective: "Respect customer preferences and consent for every message the feature sends.",
  },
  { re: /\b(remind|notif|e-?mail|sms|push message|alert)/i, title: "Notifications and reminders", objective: "Send the right message to the right customer at the right time." },
  { re: /\b(export|csv|download|file)/i, title: "Export", objective: "Let authorised users take the data out in a standard format." },
  { re: /\b(audit|evidence|history|trail)/i, title: "Audit trail and evidence", objective: "Record who did what and when, so the record holds up in a dispute." },
];

function clean(text: string, max = 120) {
  return shorten(text.replace(/\s*(?:[—–;,-]\s*)?see Q\d+.*$/i, ""), max);
}

/** "The list underlying the counts can be retrieved, …" → "The list underlying the counts". */
function candidateTitle(text: string): string {
  // Drop "(IP address, device, …)" asides first so their commas do not cut the clause short.
  let plain = text.replace(/\(Candidate\)\s*/i, "");
  for (let i = 0; i < 3 && /\([^()]*\)/.test(plain); i++) plain = plain.replace(/\s*\([^()]*\)/g, "");
  const clause = plain.split(/\s+(?:can|must|should|shall|will|is|are)\s|[,;:—–]/)[0]?.trim() || plain;
  return shorten(clause, 60).replace(/[.…]$/, "");
}

/**
 * Group BRD requirements into epics: themed groups (access, filters, notifications…) plus one
 * core epic for the rest, capped at 5; a candidate that cites an open question becomes its own
 * draft epic parked behind that question, and a candidate that cites none gets no epic until the
 * PO confirms it in the BRD; the Implementation Plan checklist becomes a non-dev launch-readiness
 * epic. `name` (the project's own name) titles the core epic; it defaults to the BRD title.
 */
export function proposeEpicsFromBrd(title: string, requirements: BrdRequirement[], implementationPlan: string[], name: string = title): EpicProposal[] {
  const confirmed = requirements.filter((r) => !r.candidate);
  const groups = new Map<string, { title: string; objective: string; reqs: BrdRequirement[] }>();
  const core = { title: `${name}: core experience`, objective: "", reqs: [] as BrdRequirement[] };
  for (const r of confirmed) {
    const theme = THEMES.find((t) => t.re.test(r.text));
    if (!theme) {
      core.reqs.push(r);
      continue;
    }
    const g = groups.get(theme.title) ?? { title: theme.title, objective: theme.objective, reqs: [] };
    g.reqs.push(r);
    groups.set(theme.title, g);
  }
  const themed = [...groups.values()];
  // Too many small themes: fold the smallest into the core epic (max 5 epics incl. core).
  while (themed.length > 4) {
    themed.sort((a, b) => a.reqs.length - b.reqs.length);
    core.reqs.push(...themed.shift()!.reqs);
  }
  // When every requirement matched a theme there is no core epic.
  const all = core.reqs.length ? [core, ...themed] : themed;
  const order = (g: { reqs: BrdRequirement[] }) => Math.min(...g.reqs.map((r) => Number(r.id.split("-")[1])));
  const out: EpicProposal[] = all
    .filter((g) => g.reqs.length)
    .sort((a, b) => order(a) - order(b))
    .map((g) => {
      const refs = g.reqs.map((r) => r.id);
      return {
        title: g.title,
        objective: g.objective || clean(g.reqs[0].text, 160),
        context: `Proposed from the BRD "${title}", requirements ${refs.join(", ")}.`,
        inScope: g.reqs.map((r) => clean(r.text)),
        brdRequirementRefs: refs,
      };
    });
  for (const r of requirements.filter((x) => x.candidate)) {
    const blockedBy = questionRefs(r.text);
    // Unconfirmed and blocked by nothing: an epic now could be accepted and pushed to Jira.
    if (!blockedBy.length) continue;
    out.push({
      title: `${candidateTitle(r.text)} (candidate)`,
      objective: clean(r.text, 160),
      context: `Candidate requirement ${r.id} in the BRD "${title}"; confirm scope before planning it.`,
      inScope: [clean(r.text)],
      brdRequirementRefs: [r.id],
      blockedBy,
    });
  }
  if (implementationPlan.length) {
    out.push({
      title: "Launch readiness (non-dev)",
      objective: "Prepare communications, help content and training so the release lands.",
      context: `From the BRD Implementation Plan checklist for "${title}".`,
      inScope: implementationPlan,
      brdRequirementRefs: [],
    });
  }
  return out;
}

const STOP = new Set(
  "about above after again against also because been before being below between both could does doing down during each existing from further have having here into itself just more most only other over proposed same should some such than that their them then there these they this those through under until very were what when where which while will with would your change changes changed system service services based source owned read-only readonly option only new".split(
    " ",
  ),
);

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/[\s-]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  );
}

function aliases(system: string): string[] {
  const base = system.replace(/\(.*?\)/g, "").trim().toLowerCase();
  const out = [base];
  if (base.startsWith("website-")) out.push(base.slice("website-".length));
  return out;
}

/** Systems the epic touches: named explicitly, or sharing enough vocabulary with the change text. */
function matchSystems(epicText: string, systems: SystemChange[]): string[] {
  const text = epicText.toLowerCase();
  const epicWords = words(epicText);
  const changed = systems.filter((s) => s.changed);
  const explicit = changed.filter((s) => aliases(s.system).some((a) => text.includes(a))).map((s) => s.system);
  const scored = changed
    .map((s) => ({ s: s.system, score: [...words(`${s.system} ${s.change}`)].filter((w) => epicWords.has(w)).length }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.s);
  return uniq([...explicit, ...scored]);
}

export interface EpicUpdate {
  epic: Epic;
  patch: Partial<Pick<Epic, "aadRefs" | "designElements" | "systems" | "blockedBy">>;
  before: EpicHistoryEntry["before"];
  change: string;
}

function diffList(label: string, before: string[], after: string[]): string | undefined {
  const added = after.filter((x) => !before.includes(x));
  const removed = before.filter((x) => !after.includes(x));
  const parts = [added.length ? `+ ${label} ${added.join(", ")}` : "", removed.length ? `- ${label} ${removed.join(", ")}` : ""].filter(Boolean);
  return parts.length ? parts.join("; ") : undefined;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** What the accepted AAD changes on each epic (FR refs, design elements, systems). */
export function aadEpicUpdates(epics: Epic[], frs: AadRequirement[], systems: SystemChange[], curated?: CuratedEpic[]): EpicUpdate[] {
  const updates: EpicUpdate[] = [];
  for (const epic of epics) {
    const mine = frs.filter((fr) => fr.traces.some((t) => epic.brdRequirementRefs.includes(t)));
    const hint = curated?.find((c) => c.title === epic.title)?.architecture;
    const aadRefs = mine.map((fr) => fr.id);
    const designElements = uniq(mine.map((fr) => fr.designElement).filter((d): d is string => !!d).map((d) => shorten(d, 140)));
    const epicText = [epic.title, epic.objective, ...epic.inScope, ...mine.map((fr) => `${fr.text} ${fr.designElement ?? ""}`)].join(" ");
    const matched = hint?.systems ?? (mine.length ? matchSystems(epicText, systems) : []);
    const systemsAfter = uniq([...epic.systems, ...matched]);
    const blockedAfter = hint?.blockedBy ? uniq([...(epic.blockedBy ?? []), ...hint.blockedBy]) : epic.blockedBy;
    const patch: EpicUpdate["patch"] = {};
    const before: NonNullable<EpicHistoryEntry["before"]> = {};
    const notes: string[] = [];
    if (!same(epic.aadRefs, aadRefs) && aadRefs.length) {
      patch.aadRefs = aadRefs;
      before.aadRefs = epic.aadRefs;
      const d = diffList("FRs", epic.aadRefs, aadRefs);
      if (d) notes.push(d);
    }
    if (!same(epic.designElements, designElements) && designElements.length) {
      patch.designElements = designElements;
      before.designElements = epic.designElements;
      notes.push(`${designElements.length} design element${designElements.length === 1 ? "" : "s"} from the AAD`);
    }
    if (!same(epic.systems, systemsAfter)) {
      patch.systems = systemsAfter;
      before.systems = epic.systems;
      const d = diffList("systems", epic.systems, systemsAfter);
      if (d) notes.push(d);
    }
    if (blockedAfter && !same(epic.blockedBy ?? [], blockedAfter)) {
      patch.blockedBy = blockedAfter;
      notes.push(`blocked by ${blockedAfter.join(", ")}`);
    }
    if (notes.length) updates.push({ epic, patch, before, change: notes.join("; ") });
  }
  return updates;
}
