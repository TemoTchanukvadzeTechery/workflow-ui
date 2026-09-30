import { STAGES, stageDef, type StageId, type StageStatus } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { stageStatusMeta, type Tone } from "@/lib/weft/labels";
import { toneClasses } from "./tone";

export type SegmentState = "done" | "partial" | "empty";

export interface Segment {
  tone: Tone;
  /** done = striped fill, partial = the same stripes at 60% (in progress), empty = track only. */
  state: SegmentState;
  /** Shown as a tooltip and read by screen readers, e.g. "Requirements: Approved". */
  label?: string;
}

export interface SegmentBarProps {
  segments: Segment[];
  size?: "sm" | "md" | "lg";
  /** Accessible summary; defaults to the joined segment labels. */
  label?: string;
  className?: string;
}

/** sm 6px (row mini-bars), md 10px, lg 14px (the reference's breakdown bars). */
const HEIGHT = { sm: "h-1.5", md: "h-2.5", lg: "h-3.5" } as const;
const STATE_WORD: Record<SegmentState, string> = { done: "done", partial: "in progress", empty: "not started" };

/**
 * Equal-width segments, e.g. the mini 5-stage bar in project rows (STYLE.md 5): striped pills on
 * white tracks; partial segments use the same stripes at 60% opacity.
 */
export function SegmentBar({ segments, size = "md", label, className }: SegmentBarProps) {
  const summary = label ?? segments.map((s, i) => s.label ?? `Segment ${i + 1}: ${STATE_WORD[s.state]}`).join(", ");
  return (
    <div role="img" aria-label={summary} className={cn("flex w-full items-center gap-[3px]", className)}>
      {segments.map((s, i) => (
        <span key={i} title={s.label} className={cn("min-w-0 flex-1 overflow-hidden rounded-full bar-track", HEIGHT[size])}>
          {s.state !== "empty" && <span className={cn("block size-full rounded-full", segmentClass(s))} />}
        </span>
      ))}
    </div>
  );
}

function segmentClass(s: Segment): string {
  const t = toneClasses(s.tone);
  return s.state === "partial" ? cn(t.stripe, "opacity-60") : t.stripe;
}

export interface HatchedBarProps {
  /** Units finished (striped). */
  done: number;
  /** Units in progress (striped at 60%), drawn after `done`. */
  partial?: number;
  total: number;
  tone?: Tone;
  size?: "sm" | "md" | "lg";
  /** Accessible label, e.g. "7 of 9 tasks approved". */
  label?: string;
  className?: string;
}

/**
 * A single progress bar (STYLE.md 5): a striped pill on a white track, done in full stripes and
 * in-progress units in the same stripes at 60%.
 */
export function HatchedBar({ done, partial = 0, total, tone = "success", size = "md", label, className }: HatchedBarProps) {
  const t = toneClasses(tone);
  const safeTotal = Math.max(total, 0);
  const pct = (n: number) => (safeTotal === 0 ? 0 : Math.min(100, Math.max(0, (n / safeTotal) * 100)));
  const donePct = pct(done);
  const partialPct = Math.min(100 - donePct, pct(partial));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={safeTotal}
      aria-valuenow={done}
      aria-label={label ?? `${done} of ${safeTotal} done${partial ? `, ${partial} in progress` : ""}`}
      className={cn("bar-track flex w-full overflow-hidden rounded-full", HEIGHT[size], className)}
    >
      {donePct + partialPct > 0 && (
        <span className="flex h-full overflow-hidden rounded-full" style={{ width: `${donePct + partialPct}%` }}>
          {donePct > 0 && <span className={cn("h-full", t.stripe)} style={{ width: `${(donePct / (donePct + partialPct)) * 100}%` }} />}
          {partialPct > 0 && <span className={cn("h-full flex-1 opacity-60", t.stripe)} />}
        </span>
      )}
    </div>
  );
}

/** One stage as a segment: approved = green stripes, active = lighter stripes in its status tone, else track. */
export function stageSegment(stage: StageId, status: StageStatus | undefined): Segment {
  const meta = stageStatusMeta(status ?? "locked");
  const label = `${stageDef(stage).title}: ${meta.label}`;
  if (status === "approved") return { tone: "success", state: "done", label };
  if (!status || status === "locked" || status === "not_started") return { tone: "neutral", state: "empty", label };
  return { tone: meta.tone, state: "partial", label };
}

/** The mini 5-stage bar for a project row: `<SegmentBar segments={stageSegments(p.stageStatuses)} />`. */
export function stageSegments(statuses: Partial<Record<StageId, StageStatus>>): Segment[] {
  return STAGES.map((s) => stageSegment(s.id, statuses[s.id]));
}
