"use client";

/**
 * Test output, Logs and Data tabs of the evidence gallery. Output and logs are mono 12px; log
 * lines are toned by level (warnings amber, errors red) and filterable.
 */
import { Check, Copy } from "lucide-react";
import { useId, useState } from "react";
import { JsonView } from "@/components/common";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCopy } from "@/hooks/use-copy";
import type { Evidence } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { EvidenceItem } from "./EvidenceItem";
import { lineLevel, type LogLevel } from "./utils";

interface PanelProps {
  items: Evidence[];
  onSelectAc?: (acId: string) => void;
  activeAc?: string | null;
  highlightId?: string | null;
  onJumpTo?: (id: string) => void;
}

export function CommandLine({ command }: { command: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-lg bg-muted px-2.5 py-2">
      <span aria-hidden className="shrink-0 font-mono text-xs text-muted-foreground select-none">
        $
      </span>
      <code className="min-w-0 flex-1 font-mono text-xs break-all text-foreground">{command}</code>
      <button
        type="button"
        onClick={() => void copy(command, "Command")}
        aria-label={copied ? "Copied command" : "Copy command"}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {copied ? <Check aria-hidden className="size-3.5 text-status-success-fg" /> : <Copy aria-hidden className="size-3.5" />}
      </button>
    </div>
  );
}

function ExitCode({ code }: { code: number }) {
  const ok = code === 0;
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-md px-1.5 font-mono text-[11px]", ok ? "bg-status-success-bg text-status-success-fg" : "bg-status-danger-bg text-status-danger-fg")}>
      exit {code}
    </span>
  );
}

/** "18 passed · 0 failed · 1 skipped" with a thin stacked bar. */
export function CountsBar({ counts }: { counts: { passed: number; failed: number; skipped: number } }) {
  const total = counts.passed + counts.failed + counts.skipped;
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-foreground/[0.08]" aria-hidden>
        {counts.passed ? <span className="h-full bg-status-success-fg" style={{ width: `${pct(counts.passed)}%` }} /> : null}
        {counts.failed ? <span className="h-full bg-status-danger-fg" style={{ width: `${pct(counts.failed)}%` }} /> : null}
        {counts.skipped ? <span className="h-full bg-muted-foreground/60" style={{ width: `${pct(counts.skipped)}%` }} /> : null}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        <span className="text-foreground">{counts.passed}</span> passed · <span className={counts.failed ? "font-medium text-status-danger-fg" : "text-foreground"}>{counts.failed}</span> failed ·{" "}
        <span className="text-foreground">{counts.skipped}</span> skipped
      </p>
    </div>
  );
}

function Excerpt({ text, toneLines }: { text: string; toneLines?: boolean }) {
  const lines = text.split("\n");
  return (
    <pre className="relative max-h-72 min-w-0 overflow-auto rounded-lg border bg-background px-3 py-2 font-mono text-xs leading-5">
      {lines.map((l, i) => {
        const level = toneLines ? lineLevel(l, false) : null;
        return (
          <div key={i} className={cn("whitespace-pre", level === "error" && "text-status-danger-fg", level === "warn" && "text-status-attention-fg", /✗|✕|FAIL(ED)?\b/.test(l) && "text-status-danger-fg")}>
            {l || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function TestOutputTab({ items, onSelectAc, activeAc, highlightId, onJumpTo }: PanelProps) {
  return (
    <div className="space-y-3">
      {items.map((e) => (
        <EvidenceItem key={e.id} item={e} onSelectAc={onSelectAc} activeAc={activeAc} highlighted={highlightId === e.id} onJumpTo={onJumpTo}>
          <div className="space-y-2.5">
            {e.command ? <CommandLine command={e.command} /> : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {e.exitCode !== undefined ? <ExitCode code={e.exitCode} /> : null}
              {e.testLevel ? <span className="text-xs text-muted-foreground">Level <span className="font-medium text-foreground uppercase">{e.testLevel}</span></span> : null}
              {e.counts ? <CountsBar counts={e.counts} /> : null}
            </div>
            {e.excerpt ? <Excerpt text={e.excerpt} toneLines /> : null}
          </div>
        </EvidenceItem>
      ))}
    </div>
  );
}

type LevelFilter = "all" | "warn" | "error";

export function LogsTab({ items, onSelectAc, activeAc, highlightId, onJumpTo }: PanelProps) {
  const [filter, setFilter] = useState<LevelFilter>("all");
  const labelId = useId();
  const keep = (lvl: LogLevel) => filter === "all" || (filter === "warn" ? lvl === "warn" || lvl === "error" : lvl === "error");
  const allLines = items.flatMap((e) => (e.excerpt ?? "").split("\n").filter(Boolean));
  const counts = { warn: allLines.filter((l) => lineLevel(l) === "warn").length, error: allLines.filter((l) => lineLevel(l) === "error").length };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground" id={labelId}>
          Level
        </span>
        <ToggleGroup type="single" size="sm" variant="outline" value={filter} onValueChange={(v) => v && setFilter(v as LevelFilter)} aria-labelledby={labelId}>
          <ToggleGroupItem value="all" className="px-2.5 text-xs">
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="warn" className="px-2.5 text-xs">
            Warnings+ <span className="font-mono text-[10.5px] text-status-attention-fg">{counts.warn + counts.error}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="error" className="px-2.5 text-xs">
            Errors <span className="font-mono text-[10.5px] text-status-danger-fg">{counts.error}</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {items.map((e) => {
        const lines = (e.excerpt ?? "").split("\n").filter((l) => l.length > 0);
        const shown = lines.filter((l) => keep(lineLevel(l)));
        return (
          <EvidenceItem key={e.id} item={e} onSelectAc={onSelectAc} activeAc={activeAc} highlighted={highlightId === e.id} onJumpTo={onJumpTo}>
            <div className="space-y-2">
              {e.command ? <CommandLine command={e.command} /> : null}
              {e.exitCode !== undefined ? <ExitCode code={e.exitCode} /> : null}
              {lines.length === 0 ? (
                <p className="text-xs text-muted-foreground">No log lines captured.</p>
              ) : shown.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">No {filter === "error" ? "errors" : "warnings or errors"} in this log.</p>
              ) : (
                <pre className="relative max-h-72 min-w-0 overflow-auto rounded-lg border bg-background px-3 py-2 font-mono text-xs leading-5" aria-label={`${e.title} log lines`}>
                  {shown.map((l, i) => {
                    const lvl = lineLevel(l);
                    return (
                      <div key={i} className={cn("whitespace-pre", lvl === "error" && "text-status-danger-fg", lvl === "warn" && "text-status-attention-fg", lvl === "debug" && "text-muted-foreground")}>
                        {l}
                      </div>
                    );
                  })}
                </pre>
              )}
            </div>
          </EvidenceItem>
        );
      })}
    </div>
  );
}

function isMetric(v: unknown): v is { name: string; actual: number; expected?: number; unit?: string } {
  return !!v && typeof v === "object" && typeof (v as { actual?: unknown }).actual === "number";
}

export function DataTab({ items, onSelectAc, activeAc, highlightId, onJumpTo }: PanelProps) {
  return (
    <div className="space-y-3">
      {items.map((e) => (
        <EvidenceItem key={e.id} item={e} onSelectAc={onSelectAc} activeAc={activeAc} highlighted={highlightId === e.id} onJumpTo={onJumpTo}>
          <div className="space-y-2">
            {e.kind === "metric" && isMetric(e.data) ? (
              <div className="flex flex-wrap items-end gap-x-6 gap-y-2 rounded-lg bg-muted px-3 py-2.5">
                <div>
                  <div className="kicker">{e.data.name}</div>
                  <div className={cn("text-2xl tabular-nums", e.result === "fail" ? "text-status-danger-fg" : "text-foreground")}>
                    {e.data.actual.toLocaleString("en-US")} <span className="text-sm text-muted-foreground">{e.data.unit}</span>
                  </div>
                </div>
                {e.data.expected !== undefined ? (
                  <div>
                    <div className="kicker">Budget</div>
                    <div className="text-2xl text-muted-foreground tabular-nums">
                      {e.data.expected.toLocaleString("en-US")} <span className="text-sm">{e.data.unit}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {e.command ? <CommandLine command={e.command} /> : null}
            {e.data !== undefined ? (
              <div className="rounded-lg border bg-background py-2 pr-2">
                <JsonView value={e.data} collapsed={2} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No data payload.</p>
            )}
          </div>
        </EvidenceItem>
      ))}
    </div>
  );
}
