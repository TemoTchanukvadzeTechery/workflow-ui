import "server-only";
/**
 * architect-aad [REAL], mirrored from po-workspace/.weft/workflows/architect-aad/main.ts: read
 * the accepted BRD (B1), discover the tickets, pages and earlier designs the AAD depends on,
 * draft it from the BRD and the architect's notes, loop on architect review, then propose a
 * memory update the architect approves. Discovery, notes and memory are shared with po-brd.
 */
import type { AadReport } from "@/lib/delivery/types";
import type { ArchitectAadInput, ArchitectAadOutput } from "@/lib/weft/workflows";
import type { MockWorkflow, ScriptCtx } from "../engine/api";
import { discover } from "./lib/discover";
import { draftLoop } from "./lib/draft";
import { ARCHITECT_AAD_INPUT_JSON, ARCHITECT_AAD_OUTPUT_JSON, parseArchitectAadInput } from "./lib/input";
import { Kit } from "./lib/kit";
import { MEMORY_PATH, loadMemory, updateMemory } from "./lib/memory";
import { loadNotes } from "./lib/notes";
import { preflight } from "./lib/preflight";
import { extractRefs, noteEntries } from "./lib/text";

const EMPTY_REPORT = (path: string): AadReport => ({
  path,
  missingSections: [],
  untracedRequirements: [],
  blockingQuestions: [],
  decisionsNeeded: [],
  conflicts: [],
  ignoredInstructions: [],
  changes: [],
});

async function script(ctx: ScriptCtx<ArchitectAadInput>, input: ArchitectAadInput): Promise<ArchitectAadOutput> {
  const kit = new Kit(ctx);
  const projectId = ctx.meta.projectId;
  const entries = noteEntries(input.request, input.notes);
  const skill = await preflight(kit, {
    skill: input.skill,
    hasInput: entries.length > 0 || input.brd !== "",
    noInputError: "Provide a BRD path in brd, the architect's request in request, or at least one note.",
  });

  ctx.phase("Memory");
  const memory = await loadMemory(kit, MEMORY_PATH);

  // The accepted BRD is the primary requirements source; its references seed discovery too.
  ctx.phase("Discover");
  const brdFile = input.brd ? await kit.read(input.brd) : undefined;
  const brd = brdFile ? { path: input.brd, content: brdFile.content } : undefined;
  const notePaths = [...entries];
  const initialNotes = await loadNotes(kit, notePaths, "Architect notes", "A");
  const seeds = [...new Set([...input.seeds, ...extractRefs(`${brd?.content ?? ""}\n${initialNotes.text}`)])];
  const evidence = input.discover
    ? await discover(kit, {
        docType: "AAD",
        seeds,
        rounds: input.discoveryRounds,
        maxQueries: input.maxQueries,
        text: `${initialNotes.text}\n${brd?.content ?? ""}`,
        out: input.out,
        projectId,
      })
    : [];
  const dependencies = evidence.map(({ id, ref, kind, relation, title }) => ({ id, ref, kind, relation, title }));

  const loop = await draftLoop<AadReport>(kit, {
    docType: "AAD",
    out: input.out,
    request: input.request,
    maxRounds: input.maxRounds,
    notePaths,
    brd,
    evidence,
    memory,
    skill: { path: input.skill },
    projectId,
    projectName: ctx.meta.projectName,
  });

  const lastReport = loop.lastReport ?? EMPTY_REPORT(input.out);
  const result = { path: input.out, accepted: loop.accepted, rounds: loop.rounds, lastReport, dependencies, skillSha256: skill.sha256 };
  if (!loop.accepted) {
    ctx.note({ kind: "decision", text: `AAD not accepted after ${input.maxRounds} rounds; memory left unchanged`, evidence: "" });
    return { ...result, memory: { status: "skipped", major: false, changes: [], stale: memory.stale } };
  }

  // Only an accepted AAD reaches memory, and only through an architect-approved update.
  ctx.phase("Update memory");
  const final = await kit.read(input.out);
  await kit.gitLog({ paths: [input.out], max: 1 });
  const update = await updateMemory(kit, {
    memory,
    doc: { type: "AAD", path: input.out, content: final.content, sha256: final.sha256 },
    owner: "architect",
    runId: ctx.runId,
    projectId,
  });
  return { ...result, memory: { ...update, stale: memory.stale } };
}

export const architectAad: MockWorkflow<ArchitectAadInput, ArchitectAadOutput> = {
  id: "architect-aad",
  description:
    "Discover related tickets, pages, and earlier designs, draft an Architecture Approach Document from the BRD and architect notes, revise it until the architect accepts, and update the shared memory",
  file: ".weft/workflows/architect-aad/main.ts",
  input: ARCHITECT_AAD_INPUT_JSON,
  output: ARCHITECT_AAD_OUTPUT_JSON,
  parseInput: parseArchitectAadInput,
  defaults: { provider: "claude", effort: "medium" },
  real: true,
  script,
};
