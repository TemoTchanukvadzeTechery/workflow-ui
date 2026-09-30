"use client";

/**
 * Task page tabs over a run's verification: Checks (each weft CheckState with its command, exit
 * code, output excerpt, metrics and files, grouped by verify cycle) and Acceptance criteria
 * (AC-n met / not met / not verified yet, the dev tests that name it and the QA evidence).
 */
import { ChevronDown, ChevronRight, CircleCheck, CircleDashed, CircleX, FileCode2, Gauge, TerminalSquare } from "lucide-react";
import { useState } from "react";
import { EmptyState, StatusPill } from "@/components/common";
import { MonoChip } from "@/components/hitl";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { DeliveryTask, Evidence } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import type { CheckEvidence, CheckState, RunDetail } from "@/lib/weft/types";

export interface CheckEntry {
  check: CheckState;
  /** Step key when the run's check steps line up with its checks, e.g. "check:lint:retry". */
  key?: string;
  retry: boolean;
}

/**
 * Split a run's checks into verify cycles. dev-task check steps are keyed check:<name>,
 * check:<name>:retry and check:<name>:rework:<n>, one per CheckState in order, so the rework
 * number picks the cycle. Otherwise (qa-verify runs its tests as bash steps) a name seen again
 * starts the next cycle.
 */
export function checkCycles(run: Pick<RunDetail, "checks" | "steps">): CheckEntry[][] {
  const steps = run.steps.filter((s) => s.kind === "check");
  if (steps.length === run.checks.length && steps.length > 0) {
    const by = new Map<number, CheckEntry[]>();
    run.checks.forEach((check, i) => {
      const key = steps[i]!.key ?? "";
      const n = Number(/:rework:(\d+)/.exec(key)?.[1] ?? 0);
      by.set(n, [...(by.get(n) ?? []), { check, key, retry: /:retry\b/.test(key) }]);
    });
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
  }
  const cycles: CheckEntry[][] = [];
  let seen = new Set<string>();
  for (const c of run.checks) {
    if (cycles.length === 0 || seen.has(c.name)) {
      cycles.push([]);
      seen = new Set();
    }
    cycles[cycles.length - 1]!.push({ check: c, retry: false });
    seen.add(c.name);
  }
  return cycles;
}

/** Latest outcome per check name within a cycle (a retried check counts once). */
function cycleResult(list: readonly CheckEntry[]): { passed: number; total: number } {
  const last = new Map<string, CheckState>();
  for (const e of list) last.set(e.check.name, e.check);
  const all = [...last.values()];
  return { passed: all.filter((c) => c.status === "pass").length, total: all.length };
}

function cycleLabel(i: number, workflow: string): string {
  if (workflow === "qa-verify") return i === 0 ? "Automated tests" : `Re-run ${i}`;
  return i === 0 ? "Verify" : `Verify after rework ${i}`;
}

function excerpt(text: string, max = 20): { text: string; cut: number } {
  const lines = text.replace(/\n+$/, "").split("\n");
  return lines.length <= max ? { text: lines.join("\n"), cut: 0 } : { text: lines.slice(-max).join("\n"), cut: lines.length - max };
}

function Detail({ d }: { d: CheckEvidence }) {
  if (d.kind === "command") {
    const ex = d.output ? excerpt(d.output) : null;
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <TerminalSquare aria-hidden className="size-3.5" />
          Output
          <MonoChip className={cn(d.exitCode === 0 ? "text-status-success-fg" : "text-status-danger-fg")}>exit {d.exitCode}</MonoChip>
          {ex?.cut ? <span>last 20 lines, {ex.cut} earlier lines hidden</span> : null}
        </div>
        {ex ? <pre className="relative max-h-64 overflow-auto rounded-lg bg-muted/60 px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-foreground">{ex.text}</pre> : null}
      </div>
    );
  }
  if (d.kind === "metric") {
    const ok = d.expected === undefined ? undefined : d.actual <= d.expected;
    return (
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Gauge aria-hidden className="size-3.5 text-muted-foreground" />
        <span>{d.name}</span>
        <span className="font-mono tabular-nums">
          {d.actual}
          {d.unit ? ` ${d.unit}` : ""}
        </span>
        {d.expected !== undefined ? (
          <span className={cn("text-xs", ok ? "text-status-success-fg" : "text-status-danger-fg")}>
            budget {d.expected}
            {d.unit ? ` ${d.unit}` : ""}
          </span>
        ) : null}
      </div>
    );
  }
  if (d.kind === "file") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <FileCode2 aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="font-mono text-xs">
          {d.path}
          {d.line ? `:${d.line}` : ""}
        </span>
        {d.message ? <span className="text-muted-foreground">{d.message}</span> : null}
      </div>
    );
  }
  if (d.kind === "artifact") return <p className="text-[13px] text-muted-foreground">Artifact: {d.label ?? d.ref}</p>;
  return <p className="text-[13px] whitespace-pre-wrap">{d.text}</p>;
}

function CheckRow({ entry }: { entry: CheckEntry }) {
  const { check } = entry;
  const pass = check.status === "pass";
  return (
    <li className="space-y-2 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={pass ? "success" : "danger"} icon={pass ? CircleCheck : CircleX} size="sm" label={pass ? "Pass" : "Fail"} />
        <span className="font-mono text-[13px] font-medium">{check.name}</span>
        {entry.retry ? <MonoChip>retry</MonoChip> : null}
        {check.required ? <MonoChip>required</MonoChip> : <MonoChip>optional</MonoChip>}
        {check.disposition !== "executed" ? <MonoChip className="text-status-attention-fg">{check.disposition}</MonoChip> : null}
        {check.summary ? <span className="min-w-0 text-[13px] text-muted-foreground">{check.summary}</span> : null}
      </div>
      {check.evidence ? (
        <p className="min-w-0 font-mono text-[12px] break-all text-foreground">
          <span className="text-muted-foreground select-none">$ </span>
          {check.evidence}
        </p>
      ) : null}
      {check.details?.length ? (
        <div className="space-y-2">
          {check.details.map((d, i) => (
            <Detail key={i} d={d} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function ChecksPanel({ run }: { run: RunDetail }) {
  const cycles = checkCycles(run);
  // Explicit toggles only; by default the latest cycle is open (also when a new one arrives live).
  const [toggled, setToggled] = useState<Record<number, boolean>>({});
  if (cycles.length === 0) {
    return <EmptyState size="sm" icon={CircleDashed} title="No checks yet" body={run.status === "complete" || run.status === "failed" || run.status === "cancelled" ? "This run recorded no checks." : "Checks run in the Verify phase, after the agent's changes."} />;
  }
  return (
    <div className="space-y-3">
      {cycles.map((list, i) => {
        const { passed, total } = cycleResult(list);
        const isOpen = toggled[i] ?? i === cycles.length - 1;
        return (
          <Collapsible
            key={i}
            open={isOpen}
            onOpenChange={(o) => setToggled((s) => ({ ...s, [i]: o }))}
            className="overflow-hidden rounded-xl border border-border bg-card"
          >
            <CollapsibleTrigger className="flex w-full items-center gap-2 bg-muted/40 px-4 py-2 text-left text-[13px] outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
              {isOpen ? <ChevronDown aria-hidden className="size-4 text-muted-foreground" /> : <ChevronRight aria-hidden className="size-4 text-muted-foreground" />}
              <span className="font-medium">{cycleLabel(i, run.workflow)}</span>
              <span className={cn("font-mono text-xs tabular-nums", passed === total ? "text-status-success-fg" : "text-status-danger-fg")}>
                {passed}/{total} passed
              </span>
              {list.some((e) => e.retry) ? <span className="text-xs text-muted-foreground">after a fix and retry</span> : null}
              {i === cycles.length - 1 && cycles.length > 1 ? <span className="text-xs text-muted-foreground">latest</span> : null}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul>
                {list.map((e, j) => (
                  <CheckRow key={`${e.check.name}-${j}`} entry={e} />
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

/** Lines of check output that name the criterion, e.g. "✓ AC-1: authenticatedPortalRequests…". */
function testLines(runs: readonly RunDetail[], acId: string): Array<{ check: string; line: string; pass: boolean }> {
  const re = new RegExp(`\\b${acId.replace("-", "\\-")}\\b`);
  const out: Array<{ check: string; line: string; pass: boolean }> = [];
  const seen = new Set<string>();
  for (const run of runs) {
    const cycles = checkCycles(run);
    for (const { check: c } of cycles.at(-1) ?? []) {
      for (const d of c.details ?? []) {
        if (d.kind !== "command" || !d.output) continue;
        for (const raw of d.output.split("\n")) {
          const line = raw.trim();
          if (!re.test(line) || seen.has(`${c.name}|${line}`)) continue;
          seen.add(`${c.name}|${line}`);
          out.push({ check: c.name, line, pass: !/(✗|✕|FAILED|FAIL\b)/.test(line) });
        }
      }
    }
  }
  return out.slice(0, 4);
}

export function CriteriaPanel({ task, runs, evidence, onOpenEvidence }: { task: DeliveryTask; runs: RunDetail[]; evidence: Evidence[]; onOpenEvidence?: (id: string) => void }) {
  const qaDone = task.qa.status === "certified" || task.qa.status === "bugs_found" || task.qa.status === "in_review";
  if (task.acceptanceCriteria.length === 0) return <EmptyState size="sm" icon={CircleDashed} title="No acceptance criteria" body="The plan gave this task none." />;
  const met = task.acceptanceCriteria.filter((a) => a.met).length;
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-muted-foreground">
        {qaDone ? `${met} of ${task.acceptanceCriteria.length} met, per QA's evidence.` : "Dev checks name the criteria they cover; QA certifies each one with evidence in Stage 4."}
      </p>
      <ol className="overflow-hidden rounded-xl border border-border bg-card">
        {task.acceptanceCriteria.map((ac) => {
          const tests = testLines(runs, ac.id);
          const ev = (ac.evidenceIds ?? []).map((id) => evidence.find((e) => e.id === id)).filter((e): e is Evidence => !!e);
          const state = ac.met ? "met" : qaDone && ev.length ? "unmet" : "pending";
          return (
            <li key={ac.id} className="space-y-2 border-b border-border px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                <span className="w-10 shrink-0 font-mono text-xs leading-5 text-muted-foreground">{ac.id}</span>
                <span className="min-w-0 flex-1 text-[13px] leading-5">{ac.text}</span>
                {state === "met" ? (
                  <StatusPill tone="success" icon={CircleCheck} size="sm" label="Met" />
                ) : state === "unmet" ? (
                  <StatusPill tone="danger" icon={CircleX} size="sm" label="Not met" />
                ) : (
                  <StatusPill tone="neutral" icon={CircleDashed} size="sm" label="Not verified by QA yet" />
                )}
              </div>
              {tests.length ? (
                <ul className="space-y-0.5 pl-[3.25rem]">
                  {tests.map((t) => (
                    <li key={`${t.check}|${t.line}`} className="flex min-w-0 items-start gap-1.5 font-mono text-[11.5px]">
                      {t.pass ? <CircleCheck aria-label="passed" className="mt-0.5 size-3 shrink-0 text-status-success-fg" /> : <CircleX aria-label="failed" className="mt-0.5 size-3 shrink-0 text-status-danger-fg" />}
                      <span className="shrink-0 text-muted-foreground">check:{t.check}</span>
                      <span className="min-w-0 truncate" title={t.line}>
                        {t.line.replace(/^[✓✗✕]\s*/, "")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {ev.length ? (
                <div className="flex flex-wrap items-center gap-1.5 pl-[3.25rem]">
                  <span className="text-[11px] text-muted-foreground">Evidence</span>
                  {ev.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => onOpenEvidence?.(e.id)}
                      title={e.title}
                      className={cn(
                        "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 font-mono text-[11px] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        e.supersededBy ? "border-dashed text-muted-foreground" : e.result === "fail" ? "border-status-danger-fg/40 text-status-danger-fg" : "border-border text-foreground",
                      )}
                    >
                      {e.id}
                      <span className="sr-only">
                        {e.title}: {e.result}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
