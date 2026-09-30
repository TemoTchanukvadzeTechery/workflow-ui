/**
 * Pure helpers for the document page: kind labels, the stage a document belongs to, version
 * labels and the download filename. The doc endpoint returns the stored document, whose parse
 * results (open questions, AAD system changes, BRD implementation plan) are optional additions
 * to DocumentArtifact.
 */
import type { DocVersion, DocumentArtifact, DocumentKind, RequirementsStep, StageId } from "@/lib/delivery/types";

export interface OpenQuestion {
  id: string;
  text: string;
  owner?: string;
}

export interface SystemChange {
  system: string;
  status: string;
  change: string;
  changed: boolean;
}

export type DocDetail = DocumentArtifact & {
  openQuestions?: OpenQuestion[];
  systems?: SystemChange[];
  implementationPlan?: string[];
};

export const KIND_LABEL: Record<DocumentKind, string> = {
  brd: "BRD",
  aad: "AAD",
  memory: "Shared memory",
  plan: "Implementation plan",
  "ready-for-test": "Ready for test",
};

/** The page heading when the document is titled after its project. */
export const KIND_LONG: Record<DocumentKind, string> = {
  brd: "Business Requirements Document",
  aad: "Architecture Approach Document",
  memory: "Shared memory",
  plan: "Implementation plan",
  "ready-for-test": "Ready for test",
};

/** What the document is, in one line for the side panel (non-breaking hyphens in workflow names). */
export const KIND_HINT: Record<DocumentKind, string> = {
  brd: "Business Requirements Document written by po\u2011brd",
  aad: "Architecture Approach Document written by architect\u2011aad",
  memory: "The register po\u2011brd and architect\u2011aad update after each accepted document",
  plan: "The task plan dev\u2011plan wrote for Stage 3",
  "ready-for-test": "The handoff written when Implementation was approved",
};

const FIXED_STAGE: Partial<Record<DocumentKind, StageId>> = {
  brd: "requirements",
  aad: "architecture",
  plan: "implementation",
  "ready-for-test": "implementation",
};

/** The stage workspace that owns a document; memory follows the run that last wrote it. */
export function docStage(kind: DocumentKind, lastRunStage: StageId | undefined): StageId {
  return FIXED_STAGE[kind] ?? (lastRunStage === "architecture" ? "architecture" : "requirements");
}

/** The sub-step of the owning stage that shows this document. */
export function docStep(kind: DocumentKind): RequirementsStep | "plan" | undefined {
  if (kind === "brd" || kind === "aad") return "drafts";
  if (kind === "memory") return "memory";
  if (kind === "plan") return "plan";
  return undefined;
}

export const SOURCE_LABEL: Record<DocVersion["source"], string> = {
  agent: "Agent draft",
  "human-edit": "Human edit",
  import: "Imported",
};

export function sortedVersions(versions: readonly DocVersion[]): DocVersion[] {
  return [...versions].sort((a, b) => a.n - b.n);
}

/** "agreement-reporting.md" for the latest version, "agreement-reporting.v2.md" for an older one. */
export function downloadName(path: string, n: number, latest: boolean): string {
  const base = path.split("/").pop() || "document.md";
  if (latest) return base.endsWith(".md") ? base : `${base}.md`;
  const stem = base.replace(/\.md$/i, "");
  return `${stem}.v${n}.md`;
}

export function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** DOM id for a side-panel row a citation chip can jump to: "doc-ref-R3", "doc-ref-Q2". */
export const refDomId = (source: string) => `doc-ref-${source.replace(/[^A-Za-z0-9-]/g, "")}`;

/** "R3" from a citation source like "R3" or a range "R3-R5" (first id). */
export function citationTarget(source: string): string | undefined {
  const m = /^([RQ])(\d+)/.exec(source.trim());
  return m ? `${m[1]}${m[2]}` : undefined;
}

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Scroll a side-panel row into view and give it a short cobalt highlight. */
export function flashInto(el: HTMLElement): void {
  el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
  if (reducedMotion() || typeof el.animate !== "function") {
    const prev = el.style.outline;
    el.style.outline = "2px solid var(--ring)";
    window.setTimeout(() => (el.style.outline = prev), 1_800);
    return;
  }
  el.animate(
    [
      { backgroundColor: "var(--primary-soft)", boxShadow: "0 0 0 2px var(--ring)" },
      { backgroundColor: "var(--primary-soft)", boxShadow: "0 0 0 2px var(--ring)", offset: 0.6 },
      { backgroundColor: "transparent", boxShadow: "0 0 0 0 transparent" },
    ],
    { duration: 2_000, easing: "ease-out" },
  );
}
