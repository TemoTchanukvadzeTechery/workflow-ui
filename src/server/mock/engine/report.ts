import "server-only";
/**
 * `GET /api/runs/:id/report` (text/markdown): port of weft's renderReport. The only change is
 * that weft's warning-sign glyph on un-integrated patches is spelled out, since the UI renders
 * this markdown and the app uses no emoji.
 */
import type { CheckEvidence, RunState } from "@/lib/weft/types";

function reportCell(value: string | undefined): string {
  return (value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function reportEvidence(detail: CheckEvidence): string {
  switch (detail.kind) {
    case "text":
      return detail.text;
    case "file":
      return `${detail.path}${detail.line !== undefined ? `:${detail.line}` : ""}${detail.message ? ` — ${detail.message}` : ""}`;
    case "metric":
      return `${detail.name}: ${detail.actual}${detail.unit ?? ""}${detail.expected !== undefined ? ` (expected ${detail.expected}${detail.unit ?? ""})` : ""}`;
    case "command":
      return `command exited ${detail.exitCode}${detail.output ? ` — ${detail.output}` : ""}`;
    case "artifact":
      return `${detail.label ?? "artifact"}: ${detail.ref}`;
  }
}

export function renderReport(state: RunState): string {
  const lines: string[] = [];
  lines.push(`# ${state.workflow} — run ${state.runId}`);
  lines.push("");
  lines.push(`**Status:** ${state.status}`);
  const agentSteps = state.steps.filter((s) => s.kind === "agent");
  lines.push(`**Cost:** ${state.budget.tokens.toLocaleString("en-US")} tokens · $${state.budget.usd.toFixed(2)} · ${agentSteps.length} agent steps`);
  if (state.error) lines.push(`**Error:** \`${state.error.code}\` — ${state.error.message}`);
  lines.push("");

  if (state.output !== undefined) {
    lines.push("## Outcome");
    lines.push("```json");
    lines.push(JSON.stringify(state.output, null, 2));
    lines.push("```");
    lines.push("");
  }

  if (state.patches.merged.length + state.patches.captured.length > 0) {
    lines.push("## Changes");
    for (const p of state.patches.merged) {
      const captured = state.patches.captured.find((c) => c.ref === p.ref);
      lines.push(`- **${p.key}** merged${p.conflicted ? " (with conflicts kept)" : ""}: ${captured?.files.join(", ") ?? p.ref}`);
    }
    for (const p of state.patches.discarded) lines.push(`- ~~${p.key}~~ discarded`);
    const pending = state.patches.captured.filter(
      (c) => !state.patches.merged.some((m) => m.ref === c.ref) && !state.patches.discarded.some((d) => d.ref === c.ref),
    );
    for (const p of pending) lines.push(`- Warning: **${p.key}** captured but not integrated (${p.files.join(", ")})`);
    lines.push("");
  }

  if (state.checks.length > 0) {
    lines.push("## Checks");
    lines.push("| Check | Status | Disposition | Required | Summary |");
    lines.push("|---|---|---|---|---|");
    for (const c of state.checks) {
      lines.push(`| ${reportCell(c.name)} | ${c.status} | ${c.disposition} | ${c.required ? "yes" : ""} | ${reportCell(c.summary)} |`);
    }
    const withEvidence = state.checks.filter((check) => check.evidence || check.details?.length);
    if (withEvidence.length > 0) {
      lines.push("");
      lines.push("### Check evidence");
      for (const check of withEvidence) {
        if (check.evidence) lines.push(`- **${check.name}:** ${check.evidence}`);
        for (const detail of check.details ?? []) lines.push(`- **${check.name}:** ${reportEvidence(detail)}`);
      }
    }
    lines.push("");
  }

  if (state.notes.length > 0) {
    lines.push("## Ledger");
    for (const n of state.notes) lines.push(`- **${n.kind}**: ${n.text}${n.evidence ? ` _(evidence: ${n.evidence})_` : ""}`);
    lines.push("");
  }

  const failedSteps = state.steps.filter((s) => s.status === "failed");
  if (failedSteps.length + state.drops.length > 0) {
    lines.push("## Failures & drops");
    for (const s of failedSteps) lines.push(`- step ${s.key ?? s.label ?? s.seq}: ${s.error?.code} — ${s.error?.message}`);
    for (const d of state.drops) lines.push(`- dropped ${d.key ?? d.seq ?? "?"}: ${d.reason}`);
    lines.push("");
  }

  const pendingHumans = state.humans.filter((h) => h.status === "pending");
  const risks: string[] = [];
  for (const v of state.patches.violations) risks.push(`scope violation (${v.mode}): ${v.key} touched ${v.files.join(", ")}`);
  for (const h of pendingHumans) risks.push(`waiting on ${h.id} (${h.kind}): ${h.question}`);
  if (state.replay.diverged > 0) risks.push(`${state.replay.diverged} step(s) diverged from the journal on the last resume`);
  if (risks.length > 0) {
    lines.push("## Remaining risk");
    for (const r of risks) lines.push(`- ${r}`);
    lines.push("");
  }

  if (pendingHumans.length > 0) {
    lines.push("## Next step");
    const h = pendingHumans[0]!;
    lines.push(`Answer request **${h.id}**: ${h.question}`);
    lines.push("```");
    lines.push(`weft answer ${state.runId} ${h.id} '<json>'`);
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}
