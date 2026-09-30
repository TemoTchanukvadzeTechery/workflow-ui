/**
 * Pure helpers for evidence: tab grouping, per-AC results, automated counts, timeline parsing and
 * log-level detection. Shared by the gallery, the QA tasks table and the PO summary.
 */
import type { AcceptanceCriterion, DeliveryTask, Evidence } from "@/lib/delivery/types";

export type EvidenceTab = "recordings" | "screenshots" | "tests" | "logs" | "data";

export const EVIDENCE_TABS: ReadonlyArray<{ id: EvidenceTab; label: string }> = [
  { id: "recordings", label: "Recordings" },
  { id: "screenshots", label: "Screenshots" },
  { id: "tests", label: "Test output" },
  { id: "logs", label: "Logs" },
  { id: "data", label: "Data" },
];

export function evidenceTab(e: Evidence): EvidenceTab {
  switch (e.kind) {
    case "video":
      return "recordings";
    case "screenshot":
    case "contact-sheet":
      return "screenshots";
    case "command-output":
    case "test-report":
      return "tests";
    case "log":
      return "logs";
    case "data":
    case "metric":
      return "data";
  }
}

/** Test level in sentence case ("Unit", "API", "E2E", "Manual"), never shouted. */
export const TEST_LEVEL_LABEL: Record<NonNullable<Evidence["testLevel"]>, string> = { unit: "Unit", api: "API", e2e: "E2E", manual: "Manual" };

export const KIND_LABEL: Record<Evidence["kind"], string> = {
  video: "Recording",
  screenshot: "Screenshot",
  "contact-sheet": "Contact sheet",
  log: "Log",
  "test-report": "Test report",
  "command-output": "Command output",
  data: "Data",
  metric: "Metric",
};

export type AcResult = "pass" | "fail" | "inconclusive" | "none";

/** One AC's combined result over the live evidence: any fail wins, then pass, then inconclusive. */
export function acResult(ac: AcceptanceCriterion, evidence: Evidence[]): { result: AcResult; items: Array<{ e: Evidence; result: Evidence["result"]; detail?: string }> } {
  const items = evidence.flatMap((e) => e.criterionResults.filter((c) => c.criterionId === ac.id).map((c) => ({ e, result: c.result, detail: c.detail })));
  const results = items.map((i) => i.result);
  const result: AcResult = results.includes("fail") ? "fail" : results.includes("pass") ? (results.includes("inconclusive") && !ac.met ? "inconclusive" : "pass") : results.includes("inconclusive") ? "inconclusive" : "none";
  return { result, items };
}

/** Live (not superseded) evidence of one task. */
export function liveEvidence(evidence: Evidence[], taskId: string): Evidence[] {
  return evidence.filter((e) => e.taskId === taskId && !e.supersededBy);
}

export interface AutomatedCounts {
  passed: number;
  failed: number;
  skipped: number;
  /** Automated items without counts, by result. */
  items: number;
}

/** Automated pass/fail/skip, summed from test counts (items without counts count once by result). */
export function automatedCounts(evidence: Evidence[]): AutomatedCounts {
  const out: AutomatedCounts = { passed: 0, failed: 0, skipped: 0, items: 0 };
  for (const e of evidence) {
    if (e.mode !== "automated") continue;
    out.items++;
    if (e.counts) {
      out.passed += e.counts.passed;
      out.failed += e.counts.failed;
      out.skipped += e.counts.skipped;
    } else if (e.result === "pass") out.passed++;
    else if (e.result === "fail") out.failed++;
    else out.skipped++;
  }
  return out;
}

export function acMet(task: DeliveryTask): { met: number; total: number } {
  return { met: task.acceptanceCriteria.filter((a) => a.met).length, total: task.acceptanceCriteria.length };
}

/** "01:10" or "1:10:05" to seconds; NaN when unparseable. */
export function parseClock(t: string): number {
  const parts = t.trim().split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return Number.NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export type LogLevel = "error" | "warn" | "info" | "debug";

/** Log level of one line: explicit INFO/WARN/ERROR tokens, else HTTP 5xx = error, 4xx = warn. */
export function lineLevel(line: string, http = true): LogLevel {
  if (/\b(ERROR|FATAL|ERR|FAIL(ED)?)\b/.test(line)) return "error";
  if (/\b(WARN(ING)?)\b/.test(line)) return "warn";
  if (/\b(DEBUG|TRACE)\b/.test(line)) return "debug";
  if (!http) return "info";
  const status = line.match(/\s([1-5]\d{2})\s/);
  if (status) {
    const code = Number(status[1]);
    if (code >= 500) return "error";
    if (code >= 400) return "warn";
  }
  return "info";
}

export function evidenceDomId(id: string): string {
  return `evidence-${id}`;
}

/** Which pieces of evidence are paired as before/after: titles with "before"/"after", or segments. */
export function beforeAfterPairs(items: Evidence[]): Array<{ before: Evidence; after: Evidence }> {
  const shots = items.filter((e) => e.kind === "screenshot" && e.url);
  const tag = (e: Evidence): "before" | "after" | null => {
    const seg = e.segments?.length === 1 ? e.segments[0].label : null;
    if (seg === "BEFORE") return "before";
    if (seg === "AFTER") return "after";
    if (/\bbefore\b/i.test(e.title)) return "before";
    if (/\bafter\b/i.test(e.title)) return "after";
    return null;
  };
  const befores = shots.filter((e) => tag(e) === "before");
  const afters = shots.filter((e) => tag(e) === "after");
  return befores.flatMap((b, i) => (afters[i] ? [{ before: b, after: afters[i] }] : []));
}
