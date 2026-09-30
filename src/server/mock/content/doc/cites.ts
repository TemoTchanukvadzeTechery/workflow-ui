import "server-only";
/**
 * Citation placeholders for authored content, resolved against the sources a run actually has:
 * {R:CP-50894} becomes that dependency's R id (or the bare ref when the human dropped it),
 * {N:request} / {N:<path>} the PO note id, {A:…} the architect note id, {B} the BRD (B1) and
 * {M} the shared memory. Authored packs stay correct when the human adds or removes sources.
 */
import { catalogItem } from "../catalog";
import type { DraftContext, Evidence } from "../types";
import { cell, isoDate } from "@/server/mock/workflows/lib/text";

export class Cites {
  constructor(readonly ctx: DraftContext) {}

  r(ref: string): string {
    return this.ctx.evidence.find((e) => e.ref === ref)?.id ?? ref;
  }

  has(ref: string): boolean {
    return this.ctx.evidence.some((e) => e.ref === ref);
  }

  note(which: string): string {
    const notes = this.ctx.notes;
    const byPath = notes.find((n) => n.path === which || n.entry === which);
    if (byPath) return byPath.id;
    if (which === "request") {
      const req = notes.find((n) => n.path === "inline" && n.content.trim() === this.ctx.request.trim());
      if (req) return req.id;
    }
    return notes[0]?.id ?? (this.ctx.docType === "AAD" ? "A1" : "N1");
  }

  resolve(text: string): string {
    return text.replace(/\{(R|N|A):([^}]+)\}|\{(B|M)\}/g, (_m, kind: string | undefined, arg: string | undefined, bare: string | undefined) => {
      if (bare === "B") return "B1";
      if (bare === "M") return "M";
      if (kind === "R") return this.r(arg ?? "");
      return this.note(arg ?? "request");
    });
  }

  /** "R1, R3" for the refs present, else the refs themselves. */
  list(refs: readonly string[]): string {
    return refs.map((r) => this.r(r)).join(", ");
  }

  private noteRows(origin: string): string[] {
    const date = `${isoDate(this.ctx.now)} (supplied)`;
    return this.ctx.notes.map((n) => {
      const location = n.path === "inline" ? (n.content.trim() === this.ctx.request.trim() ? "Inline in the drafting request" : "Inline note text") : `\`${n.path}\``;
      return `| ${n.id} | ${n.type} | ${origin} | ${date} | ${location} |`;
    });
  }

  private evidenceRows(): string[] {
    return this.ctx.evidence.map((e) => `| ${e.id} | ${evidenceType(e)} | ${evidenceOrigin(e)} | ${evidenceDate(e)} | ${cell(`${e.ref} — ${e.title}`)} |`);
  }

  private memoryRow(): string {
    const entries = (this.ctx.memory.content.match(/^- Type: (BRD|AAD)\b/gm) ?? []).length;
    return `| M | Shared memory | \`${this.ctx.memory.path}\` | n/a | ${entries} register ${entries === 1 ? "entry" : "entries"}; stakeholders, systems, conventions and standing decisions |`;
  }

  /** The BRD Sources appendix table. */
  brdSources(): string {
    return [
      "| ID | Type | Origin / author | Date | Location |",
      "| --- | --- | --- | --- | --- |",
      ...this.noteRows("Product Owner"),
      ...this.evidenceRows(),
      this.memoryRow(),
    ].join("\n");
  }

  /** The AAD "Appendix: Sources" table. */
  aadSources(): string {
    const brd = this.ctx.brd ? [`| B1 | BRD | po-brd draft, accepted input to this AAD | ${isoDate(this.ctx.now)} (supplied) | \`${this.ctx.brd.path}\` |`] : [];
    return [
      "| ID | Type | Origin / author | Date | Location |",
      "| --- | --- | --- | --- | --- |",
      ...brd,
      ...this.noteRows("Architect"),
      ...this.evidenceRows(),
      this.memoryRow(),
    ].join("\n");
  }
}

function evidenceType(e: Evidence): string {
  const item = catalogItem(e.ref);
  if (e.kind === "confluence") return e.relation === "existing AAD" ? "Confluence page (AAD)" : e.relation === "decision record" ? "Confluence page (Decision Record)" : "Confluence page";
  return `Jira issue (${item?.type ?? "Issue"}${item?.status === "Done" ? ", Done" : ""})`;
}

function evidenceOrigin(e: Evidence): string {
  const item = catalogItem(e.ref);
  if (e.kind === "confluence") return item?.space ? `Confluence ${item.space} space` : "Confluence";
  return `Jira ${e.ref.split("-")[0]} project`;
}

function evidenceDate(e: Evidence): string {
  const item = catalogItem(e.ref);
  return item?.modified ? `updated ${item.modified}` : "not stated";
}
