import "server-only";
/**
 * The drafting rounds shared by po-brd and architect-aad (main.ts "Draft <round>"): load the
 * notes, re-read the file from round 2 on (it already carries the human's edits), run the
 * drafting agent "draft:<round>" in its worktree, capture and integrate its patch, then ask for
 * the review "review:<round>" with the file as an editable subject and the draft report as an
 * attachment, built exactly like main.ts section().
 */
import { createTwoFilesPatch } from "diff";
import type { AadReport, DraftReport } from "@/lib/delivery/types";
import { DOC_REVIEW_SCHEMA, type DocReviewAnswer } from "@/lib/weft/workflows";
import { draftDocument, reviseDocument } from "../../content";
import type { DocType, Evidence, NoteSource } from "../../content/types";
import { COSTS, PACE } from "./costs";
import type { Kit } from "./kit";
import type { MemoryState } from "./memory";
import { loadNotes } from "./notes";
import { section, sha256 } from "./text";

export interface DraftLoopOptions {
  docType: DocType;
  out: string;
  request: string;
  maxRounds: number;
  /** Note entries, extended with each review's newNotes. */
  notePaths: string[];
  brd?: { path: string; content: string };
  evidence: Evidence[];
  memory: MemoryState;
  skill: { path: string };
  projectId?: string;
  projectName?: string;
}

export interface DraftLoopResult<R> {
  accepted: boolean;
  rounds: number;
  lastReport?: R;
}

function reportMarkdown(docType: DocType, r: DraftReport | AadReport): string {
  if (docType === "BRD") {
    return [
      section("Blocking questions", r.blockingQuestions),
      section("Conflicts, including with documents in memory", r.conflicts),
      section("Sections not yet provided", r.missingSections),
      section("Instructions found in sources and ignored", r.ignoredInstructions),
      section("Changes in this round", r.changes),
    ].join("\n\n");
  }
  const a = r as AadReport;
  return [
    section("Blocking questions", a.blockingQuestions),
    section("Decisions needed", a.decisionsNeeded),
    section("BRD requirements not traced", a.untracedRequirements),
    section("Conflicts", a.conflicts),
    section("Sections not yet provided", a.missingSections),
    section("Instructions found in sources and ignored", a.ignoredInstructions),
    section("Changes in this round", a.changes),
  ].join("\n\n");
}

function question(docType: DocType, round: number, r: DraftReport | AadReport): string {
  const second = docType === "BRD" ? `${r.conflicts.length} conflicts` : `${(r as AadReport).decisionsNeeded.length} decisions needed`;
  return (
    `Round ${round}: review the ${docType} (${r.blockingQuestions.length} blocking questions, ${second}; see the draft report). ` +
    "Edit it directly if you like, then accept it or ask for a revision."
  );
}

function gitPatch(path: string, before: string | undefined, after: string): string {
  const patch = createTwoFilesPatch(before === undefined ? "/dev/null" : `a/${path}`, `b/${path}`, before ?? "", after, undefined, undefined, { context: 3 });
  const body = patch.split("\n").slice(2).join("\n");
  return `diff --git a/${path} b/${path}\n${before === undefined ? "new file mode 100644\n" : ""}${body}`;
}

export async function draftLoop<R extends DraftReport | AadReport>(kit: Kit, opts: DraftLoopOptions): Promise<DraftLoopResult<R>> {
  const ctx = kit.ctx;
  const isAad = opts.docType === "AAD";
  let feedback = "";
  let newNotes: NoteSource[] = [];
  let lastReport: R | undefined;
  let lastAgent = "";
  let accepted = false;
  let rounds = 0;

  for (let round = 1; round <= opts.maxRounds && !accepted; round++) {
    rounds = round;
    ctx.phase(`Draft ${round}`);
    const notes = await loadNotes(kit, opts.notePaths, isAad ? "Architect notes" : "PO notes", isAad ? "A" : "N");
    const current = round === 1 ? undefined : await kit.read(opts.out);
    const before = ctx.fs.read(opts.out)?.content;
    const added = newNotes.map((n) => notes.sources.find((s) => s.entry === n.entry) ?? n);
    const base = {
      docType: opts.docType,
      runId: ctx.runId,
      projectId: opts.projectId,
      ...(opts.projectName ? { projectName: opts.projectName } : {}),
      round,
      out: opts.out,
      request: opts.request,
      notes: notes.sources,
      brd: opts.brd,
      evidence: opts.evidence,
      memory: { path: opts.memory.path, content: opts.memory.content, stale: opts.memory.stale },
      now: kit.now(),
    };
    const cost = round === 1 ? COSTS[opts.docType].draft : COSTS[opts.docType].revise;
    // Deterministic, so a replayed step (whose thunk the engine may skip) can recompute the file.
    let computed: { content: string; report: DraftReport | AadReport } | undefined;
    const compute = () =>
      (computed ??= current
        ? reviseDocument({ ...base, current: current.content, lastAgent: lastAgent || current.content, feedback, newNotes: added, previousReport: lastReport! })
        : draftDocument(base));
    const report = await ctx.step<R>({
      kind: "agent",
      key: kit.key(`draft:${round}`),
      label: `draft:${round}`,
      ms: kit.ms(PACE.draft, 1500, `draft:${round}`),
      usd: cost.usd,
      tokens: cost.tokens,
      payload: {
        isolation: "worktree",
        write: { paths: [opts.out], mode: "strict" },
        maxTurns: isAad ? 30 : 20,
        task: current ? `Revise the ${opts.docType} at ${opts.out}` : `Draft a new ${opts.docType} and write it to ${opts.out}`,
        skill: opts.skill.path,
        sources: [...(opts.brd ? ["B1"] : []), ...notes.sources.map((s) => s.id), ...opts.evidence.map((e) => e.id)],
      },
      output: () => compute().report as R,
    });
    const content = compute().content;
    lastReport = report;
    lastAgent = content;

    const key = `draft:${round}`;
    ctx.patch({ key, files: [opts.out], diff: gitPatch(opts.out, before, content) });
    const baseTree = sha256(`${ctx.runId}:${round}:base`).slice(0, 40);
    await ctx.step({
      kind: "sideeffect",
      key: kit.key(`integrate:${key}`),
      label: `integrate:${key}`,
      ms: kit.ms(PACE.integrate / 2, 150, `integrate:${key}`),
      status: "integrating",
      output: { applied: true, baseTree, resultTree: sha256(content).slice(0, 40) },
    });
    await ctx.step({
      kind: "sideeffect",
      key: kit.key(`integrate:snapshot:${key}`),
      label: `integrate:snapshot:${key}`,
      ms: kit.ms(PACE.integrate / 4, 80, `snapshot:${key}`),
      status: "integrating",
      output: { baseTree, snapRef: sha256(`${ctx.runId}:snap:${round}`).slice(0, 40) },
    });
    await ctx.step({
      kind: "sideeffect",
      key: kit.key(`integrate:apply:${key}`),
      label: `integrate:apply:${key}`,
      ms: kit.ms(PACE.integrate / 4, 80, `apply:${key}`),
      status: "integrating",
      output: () => {
        ctx.fs.write(opts.out, content);
        return { ok: true };
      },
    });
    ctx.merge(key);

    // Keep the heading short and put the lists in an attachment, so the answer form stays visible.
    const { answer, edited } = await ctx.review<DocReviewAnswer>({
      key: `review:${round}`,
      subject: { kind: "file", path: opts.out, mode: "edit" },
      attachments: [{ mediaType: "text/markdown", label: "draft report", content: reportMarkdown(opts.docType, report) }],
      question: question(opts.docType, round, report),
      schema: DOC_REVIEW_SCHEMA,
    });
    if (edited) ctx.log(`${opts.out} edited by the reviewer before answering`);

    if (answer.decision === "accept") {
      accepted = true;
    } else {
      feedback = answer.feedback ?? "";
      const extra = (answer.newNotes ?? []).filter((n) => n.trim() !== "");
      opts.notePaths.push(...extra);
      newNotes = extra.map((entry) => ({ id: "", path: "inline", content: entry, type: isAad ? "Architect notes" : "PO notes", entry }));
    }
  }
  return { accepted, rounds, lastReport };
}
