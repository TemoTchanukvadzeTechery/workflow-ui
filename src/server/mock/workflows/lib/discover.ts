import "server-only";
/**
 * Dependency discovery, ported from po-brd/lib/discover.ts: fetch every seed, then per human
 * pass run planner rounds "discover:<n>" (each proposing at most maxQueries atl read commands,
 * run as "atl:<n>:<i>" behind policy gates), fetch everything relevant, and ask the human to
 * confirm the list ("deps:review:<pass>", at most three passes). Only fetched items become
 * evidence, cited R1..Rn.
 */
import { DEPENDENCY_REVIEW_SCHEMA, type DependencyReviewAnswer } from "@/lib/weft/workflows";
import { discoveryPlanner } from "../../content/discovery";
import type { Dependency, DocType, Evidence, Observation } from "../../content/types";
import { compactOutput, fetchArgs, refKind, titleOf } from "./atl";
import { PACE, discoverCost } from "./costs";
import type { Kit } from "./kit";
import { clip } from "./text";

export interface DiscoverOptions {
  docType: DocType;
  seeds: readonly string[];
  rounds: number;
  maxQueries: number;
  /** Request, notes and BRD text, for the planner's search terms. */
  text: string;
  out: string;
  projectId?: string;
}

const OBSERVATION_CHARS = 6_000;
const SOURCE_CHARS = 20_000;
const MAX_OBSERVATIONS = 40;
const MAX_PASSES = 3;

/** The planner's list plus any seed it dropped, minus everything the human removed in review. */
function mergeSeeds(found: readonly Dependency[], seeds: readonly Dependency[], removed: readonly string[]): Dependency[] {
  const kept = found.filter((d) => !removed.includes(d.ref));
  const refs = new Set(kept.map((d) => d.ref));
  return [...kept, ...seeds.filter((s) => !refs.has(s.ref) && !removed.includes(s.ref))];
}

export async function discover(kit: Kit, opts: DiscoverOptions): Promise<Evidence[]> {
  const ctx = kit.ctx;
  const observations: Observation[] = [];
  const fetched = new Map<string, string>();
  const removed: string[] = [];
  const planner = discoveryPlanner({ docType: opts.docType, projectId: opts.projectId, out: opts.out, text: opts.text, seeds: opts.seeds });
  let relevant: Dependency[] = [];
  let guidance = "";
  let round = 0;

  const runAtl = async (key: string, args: readonly string[]): Promise<string | undefined> => {
    const ran = await kit.atl(key, args);
    if (!ran) {
      observations.push({ key, args: [...args], ok: false, text: "rejected: not an allowed read command" });
      return undefined;
    }
    const { result } = ran;
    const ok = result.exitCode === 0;
    const text = ok ? compactOutput(args, result.stdout) : `exit ${result.exitCode}: ${result.stderr || result.stdout}`;
    observations.push({ key, args: [...args], ok, text: clip(text, OBSERVATION_CHARS) });
    return ok ? text : undefined;
  };

  const fetchRef = async (ref: string): Promise<string | undefined> => {
    if (fetched.has(ref)) return fetched.get(ref);
    const args = fetchArgs(ref);
    if (args === undefined) return undefined;
    const text = await runAtl(`atl:fetch:${ref}`, args);
    if (text !== undefined) fetched.set(ref, text);
    return text;
  };

  const seeded: Dependency[] = [];
  for (const ref of opts.seeds) {
    const text = await fetchRef(ref);
    seeded.push({ ref, kind: refKind(ref), title: titleOf(text, ref), relation: "named by the PO", why: "The PO supplied this reference" });
  }
  relevant = [...seeded];

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    for (let r = 1; r <= opts.rounds + 1; r++) {
      round++;
      const final = r === opts.rounds + 1;
      const cost = discoverCost(opts.docType, round);
      const state = { docType: opts.docType, pass, round, roundInPass: r, final, relevant: [...relevant], seeds: seeded, removed: [...removed], guidance, observations: [...observations] };
      const plan = await ctx.step({
        kind: "agent",
        key: kit.key(`discover:${round}`),
        label: `discover:${round}`,
        ms: kit.ms(PACE.discover, 900, `discover:${round}`),
        usd: cost.usd,
        tokens: cost.tokens,
        payload: { maxTurns: 10, pass, final, guidance: guidance || undefined, relevant: relevant.map((d) => d.ref) },
        output: () => planner.plan(state),
      });
      relevant = mergeSeeds(plan.relevant, seeded, removed);
      const queries = final ? [] : plan.queries.slice(0, opts.maxQueries);
      for (const [i, query] of queries.entries()) await runAtl(`atl:${round}:${i}`, query.args);
      if (observations.length > MAX_OBSERVATIONS) observations.splice(0, observations.length - MAX_OBSERVATIONS);
      if (final || plan.done || queries.length === 0) break;
    }

    for (const dep of relevant) await fetchRef(dep.ref);
    const list =
      relevant.length > 0
        ? relevant.map((d) => `- ${d.ref} [${d.kind}, ${d.relation}] ${d.title}${fetched.has(d.ref) ? "" : " (content not fetched)"}\n  ${d.why}`).join("\n")
        : "- none found";
    const answer = await ctx.ask<DependencyReviewAnswer>({
      key: `deps:review:${pass}`,
      question: `Pass ${pass}: ${relevant.length} dependencies found for this ${opts.docType}. Continue drafting with them, or search more?`,
      detail: list,
      schema: DEPENDENCY_REVIEW_SCHEMA,
    });
    const remove = answer.remove ?? [];
    removed.push(...remove);
    relevant = relevant.filter((d) => !remove.includes(d.ref));
    for (const raw of answer.add ?? []) {
      const ref = raw.trim();
      if (!ref || relevant.some((d) => d.ref === ref)) continue;
      // Adding a ref back undoes an earlier removal.
      if (removed.includes(ref)) removed.splice(removed.indexOf(ref), 1);
      const text = await fetchRef(ref);
      relevant.push({ ref, kind: refKind(ref), title: titleOf(text, ref), relation: "added by the PO", why: "The PO added this reference during review" });
    }
    if (answer.decision === "continue") break;
    guidance = answer.guidance ?? "";
  }

  return relevant
    .filter((d) => fetched.has(d.ref))
    .map((d, i) => ({ ...d, id: `R${i + 1}`, text: clip(fetched.get(d.ref) ?? "", SOURCE_CHARS) }));
}
