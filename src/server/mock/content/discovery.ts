import "server-only";
/**
 * The mock discovery planner (the "discover:<n>" agent). Packs replay scripted planner rounds
 * (AGR replays the real ones); everything else, and every search-more pass, searches the mock
 * catalog with keywords from the notes or the human's guidance and lists what the searches
 * actually returned, so the dependency review always matches the commands in the ledger.
 */
import { keywords } from "@/server/mock/workflows/lib/text";
import { catalogItem, type CatalogItem } from "./catalog";
import { pickPack, type ScriptedDep, type ScriptedDiscovery } from "./packs";
import type { AtlQuery, Dependency, DiscoveryPlan, DocType, Observation, Planner, PlannerState } from "./types";

export interface PlannerOptions {
  docType: DocType;
  projectId?: string;
  out: string;
  /** Request, notes and (for an AAD) the BRD: what search terms come from. */
  text: string;
  seeds: readonly string[];
}

function kindOf(ref: string): "jira" | "confluence" {
  return /^\d+$/.test(ref) ? "confluence" : "jira";
}

function describe(item: CatalogItem | undefined, ref: string, fallbackWhy: string): Dependency {
  return {
    ref,
    kind: item?.kind ?? kindOf(ref),
    title: item?.title ?? ref,
    relation: item?.relation ?? (item?.type === "Epic" ? "related ticket" : item?.kind === "confluence" ? "spec" : "related ticket"),
    why: item?.why ?? fallbackWhy,
  };
}

function resolve(dep: ScriptedDep): Dependency {
  const ref = typeof dep === "string" ? dep : dep.ref;
  const base = describe(catalogItem(ref), ref, "Listed by the planner as relevant");
  if (typeof dep === "string") return base;
  return { ...base, ...(dep.relation ? { relation: dep.relation } : {}), ...(dep.why ? { why: dep.why } : {}), ...(dep.title ? { title: dep.title } : {}) };
}

function uniq(deps: readonly Dependency[], removed: readonly string[]): Dependency[] {
  const seen = new Set<string>(removed);
  const out: Dependency[] = [];
  for (const d of deps) {
    if (seen.has(d.ref)) continue;
    seen.add(d.ref);
    out.push(d);
  }
  return out;
}

function fetchQuery(ref: string, title: string): AtlQuery {
  return kindOf(ref) === "confluence"
    ? { purpose: `Read page ${ref} "${title}" to see what it records`, args: ["confluence", "page", "get", ref, "--body"] }
    : { purpose: `Fetch ${ref} "${title}" for its status, parent and links`, args: ["jira", "issue", "get", ref, "-o", "json"] };
}

/** Refs that appear in atl output: Jira keys anywhere, page ids at the start of a result row. */
function refsIn(observations: readonly Observation[]): string[] {
  const refs: string[] = [];
  for (const o of observations) {
    if (!o.ok) continue;
    for (const m of o.text.matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)) refs.push(m[0]);
    for (const m of o.text.matchAll(/^(?:-\s+)?(\d{6,})\b/gm)) refs.push(m[1] ?? "");
  }
  return [...new Set(refs.filter(Boolean))];
}

function score(item: CatalogItem, terms: readonly string[]): number {
  const hay = `${item.title} ${item.description} ${(item.keywords ?? []).join(" ")}`.toLowerCase();
  return terms.filter((t) => hay.includes(t)).length;
}

function scriptedPlan(s: ScriptedDiscovery, state: PlannerState): DiscoveryPlan {
  const k = state.roundInPass;
  const last = s.rounds.length - 1;
  const idx = state.final ? last : Math.min(k - 1, last);
  const round = s.rounds[idx];
  const queries = state.final || k - 1 > last ? [] : (round?.queries ?? []);
  // Relevant lists are the planner's complete current list, so the latest round wins.
  const relevant = uniq([...(round?.relevant ?? []).map(resolve), ...state.relevant], state.removed);
  return { queries, relevant, done: k - 1 >= last };
}

function firstPass(opts: PlannerOptions, state: PlannerState): DiscoveryPlan {
  const kw = keywords(opts.text, 4);
  const [k1 = "requirements", k2] = kw;
  const phrase = k2 ? `${k1} ${k2}` : k1;
  if (state.final) return { queries: [], relevant: uniq(state.relevant, state.removed), done: true };

  if (state.roundInPass === 1) {
    const queries: AtlQuery[] = [];
    for (const seed of opts.seeds.slice(0, 2)) {
      const item = catalogItem(seed);
      const parent = item?.type === "Epic" ? seed : item?.parent;
      if (parent) queries.push({ purpose: `List the work under ${parent}, the ${parent === seed ? "epic the PO named" : `parent of ${seed}`}`, args: ["jira", "issue", "list", `parent = ${parent} ORDER BY created ASC`, "--limit", "25"] });
    }
    queries.push({ purpose: `Find Jira work about "${phrase}"`, args: ["jira", "issue", "list", `text ~ "${phrase}" ORDER BY created DESC`, "--limit", "25"] });
    queries.push({ purpose: `Find epics about "${k1}" that could be the parent of this work`, args: ["jira", "issue", "list", `issuetype = Epic AND text ~ "${k1}" ORDER BY created DESC`, "--limit", "25"] });
    if (opts.docType === "AAD") {
      queries.push({ purpose: "Find earlier Architecture Approach documents that set conventions for the same systems", args: ["confluence", "search", `title ~ "Architecture Approach" AND text ~ "${k1}"`, "--limit", "25"] });
      queries.push({ purpose: "Find decision records for this area", args: ["confluence", "search", `text ~ "decision record" AND text ~ "${k1}"`, "--limit", "25"] });
    } else {
      queries.push({ purpose: `Find an existing BRD or spec in PSE about "${k1}"`, args: ["confluence", "search", `space = PSE and text ~ "${k1}"`, "--limit", "25"] });
    }
    if (kw[2]) queries.push({ purpose: `Find Confluence pages about "${kw[2]}"`, args: ["confluence", "search", `text ~ "${kw[2]}"`, "--limit", "25"] });
    if (opts.seeds.length > 0) {
      queries.push({ purpose: "Find Confluence pages that mention the tickets the PO named", args: ["confluence", "search", opts.seeds.slice(0, 3).map((s) => `text ~ "${s}"`).join(" or "), "--limit", "25"] });
    }
    return { queries, relevant: uniq(state.relevant, state.removed), done: false };
  }

  // Later rounds: list what the searches returned that matches the notes, and fetch it.
  const known = new Set([...state.relevant.map((d) => d.ref), ...state.removed]);
  const seedItems = opts.seeds.map((s) => catalogItem(s)).filter((i): i is CatalogItem => !!i);
  const linked = new Set(seedItems.flatMap((i) => [i.parent ?? "", ...(i.links ?? []).map((l) => l.ref)]));
  const found = refsIn(state.observations)
    .map((ref) => catalogItem(ref))
    .filter((i): i is CatalogItem => !!i && !known.has(i.ref) && (score(i, kw) > 0 || linked.has(i.ref)))
    .sort((a, b) => score(b, kw) - score(a, kw))
    .slice(0, 10)
    .map((i) => describe(i, i.ref, `Found by the search for "${phrase}" (${i.type}${i.status ? `, ${i.status}` : ""}); matches the notes' ${kw.filter((t) => score(i, [t]) > 0).join(", ") || "context"}.`));
  const queries = found.filter((d) => !state.observations.some((o) => o.args.includes(d.ref))).map((d) => fetchQuery(d.ref, d.title));
  return { queries, relevant: uniq([...state.relevant, ...found], state.removed), done: true };
}

function searchMore(extra: readonly ScriptedDep[], opts: PlannerOptions, state: PlannerState): DiscoveryPlan {
  const terms = keywords(state.guidance, 3);
  const [t1 = keywords(opts.text, 1)[0] ?? "requirements", t2] = terms;
  if (state.final) return { queries: [], relevant: uniq(state.relevant, state.removed), done: true };
  if (state.roundInPass === 1) {
    const phrase = t2 ? `${t1} ${t2}` : t1;
    return {
      queries: [
        { purpose: `Search Jira for "${phrase}", following the reviewer's guidance`, args: ["jira", "issue", "list", `text ~ "${phrase}" ORDER BY updated DESC`, "--limit", "25"] },
        { purpose: `Search Confluence for "${t1}"`, args: ["confluence", "search", `text ~ "${t1}"`, "--limit", "25"] },
        { purpose: `Look for epics about "${t1}"`, args: ["jira", "issue", "list", `issuetype = Epic AND text ~ "${t1}" ORDER BY updated DESC`, "--limit", "25"] },
      ],
      relevant: uniq(state.relevant, state.removed),
      done: false,
    };
  }
  const known = new Set([...state.relevant.map((d) => d.ref), ...state.removed]);
  const prev = state.observations.filter((o) => o.key.startsWith(`atl:${state.round - 1}:`));
  const guided = refsIn(prev)
    .map((ref) => catalogItem(ref))
    .filter((i): i is CatalogItem => !!i && !known.has(i.ref) && score(i, terms.length > 0 ? terms : [t1]) > 0)
    .slice(0, 4)
    .map((i) => describe(i, i.ref, `Matches the guidance "${state.guidance || t1}" (${i.type}${i.status ? `, ${i.status}` : ""}).`));
  const found = uniq([...extra.map(resolve), ...guided], [...known]);
  return {
    queries: found.map((d) => fetchQuery(d.ref, d.title)),
    relevant: uniq([...state.relevant, ...found], state.removed),
    done: true,
  };
}

export function discoveryPlanner(opts: PlannerOptions): Planner {
  const scripted = pickPack(opts.projectId, opts.out)?.discovery?.[opts.docType];
  return {
    plan(state) {
      if (state.pass === 1) return scripted ? scriptedPlan(scripted, state) : firstPass(opts, state);
      return searchMore(scripted?.more?.[state.pass - 2] ?? [], opts, state);
    },
  };
}
