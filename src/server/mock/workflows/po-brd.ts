import "server-only";
/**
 * po-brd [REAL], mirrored from po-workspace/.weft/workflows/po-brd/main.ts: discover the Jira
 * tickets and Confluence pages a BRD depends on, draft the BRD from the PO's notes and those
 * sources, loop on PO review, then propose a memory update the PO approves before it is written.
 * Phases: Preflight → Memory → Discover → Draft 1..N → Update memory.
 */
import type { DraftReport } from "@/lib/delivery/types";
import type { PoBrdInput, PoBrdOutput } from "@/lib/weft/workflows";
import type { MockWorkflow, ScriptCtx } from "../engine/api";
import { discover } from "./lib/discover";
import { draftLoop } from "./lib/draft";
import { PO_BRD_INPUT_JSON, PO_BRD_OUTPUT_JSON, parsePoBrdInput } from "./lib/input";
import { Kit } from "./lib/kit";
import { MEMORY_PATH, loadMemory, updateMemory } from "./lib/memory";
import { loadNotes } from "./lib/notes";
import { preflight } from "./lib/preflight";
import { extractRefs, noteEntries } from "./lib/text";

const EMPTY_REPORT = (path: string): DraftReport => ({ path, missingSections: [], blockingQuestions: [], conflicts: [], ignoredInstructions: [], changes: [] });

async function script(ctx: ScriptCtx<PoBrdInput>, input: PoBrdInput): Promise<PoBrdOutput> {
  const kit = new Kit(ctx);
  const projectId = ctx.meta.projectId;
  const entries = noteEntries(input.request, input.notes);
  const skill = await preflight(kit, {
    skill: input.skill,
    hasInput: entries.length > 0,
    noInputError: "Provide the PO's request text in request, or at least one note in notes.",
  });

  // The memory shared with architect-aad, with register entries whose document changed since.
  ctx.phase("Memory");
  const memory = await loadMemory(kit, MEMORY_PATH);

  // First critical step: find every ticket and wiki page the requirements depend on.
  ctx.phase("Discover");
  const notePaths = [...entries];
  const initialNotes = await loadNotes(kit, notePaths);
  const seeds = [...new Set([...input.seeds, ...extractRefs(initialNotes.text)])];
  const evidence = input.discover
    ? await discover(kit, {
        docType: "BRD",
        seeds,
        rounds: input.discoveryRounds,
        maxQueries: input.maxQueries,
        text: initialNotes.text,
        out: input.out,
        projectId,
      })
    : [];
  const dependencies = evidence.map(({ id, ref, kind, relation, title }) => ({ id, ref, kind, relation, title }));

  const loop = await draftLoop<DraftReport>(kit, {
    docType: "BRD",
    out: input.out,
    request: input.request,
    maxRounds: input.maxRounds,
    notePaths,
    evidence,
    memory,
    skill: { path: input.skill },
    projectId,
    projectName: ctx.meta.projectName,
  });

  const lastReport = loop.lastReport ?? EMPTY_REPORT(input.out);
  const result = { path: input.out, accepted: loop.accepted, rounds: loop.rounds, lastReport, dependencies, skillSha256: skill.sha256 };
  if (!loop.accepted) {
    ctx.note({ kind: "decision", text: `BRD not accepted after ${input.maxRounds} rounds; memory left unchanged`, evidence: "" });
    return { ...result, memory: { status: "skipped", major: false, changes: [], stale: memory.stale } };
  }

  // Only an accepted BRD reaches memory, and only through a PO-approved update.
  ctx.phase("Update memory");
  const final = await kit.read(input.out);
  await kit.gitLog({ paths: [input.out], max: 1 });
  const update = await updateMemory(kit, {
    memory,
    doc: { type: "BRD", path: input.out, content: final.content, sha256: final.sha256 },
    owner: "PO",
    runId: ctx.runId,
    projectId,
  });
  return { ...result, memory: { ...update, stale: memory.stale } };
}

export const poBrd: MockWorkflow<PoBrdInput, PoBrdOutput> = {
  id: "po-brd",
  description:
    "Discover related Jira tickets and Confluence pages, draft a business requirements document from PO notes, revise it until the PO accepts, and update the shared memory",
  file: ".weft/workflows/po-brd/main.ts",
  input: PO_BRD_INPUT_JSON,
  output: PO_BRD_OUTPUT_JSON,
  parseInput: parsePoBrdInput,
  defaults: { provider: "claude", effort: "medium" },
  real: true,
  script,
};
