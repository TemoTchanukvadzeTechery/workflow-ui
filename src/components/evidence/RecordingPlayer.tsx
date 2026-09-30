"use client";

/**
 * HTML5 player for a recorded agent session (Plexus web-recording style): overlay facts (task,
 * build, environment), BEFORE / AFTER / PARITY segment labels, and mm:ss timeline markers that
 * seek the video. The active marker follows playback.
 */
import { Play } from "lucide-react";
import { useRef, useState } from "react";
import type { Evidence } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { clock, parseClock } from "./utils";

type SegmentLabel = "BEFORE" | "AFTER" | "PARITY";

const SEGMENT_CLASS: Record<SegmentLabel, string> = {
  BEFORE: "bg-status-neutral-bg text-status-neutral-fg",
  AFTER: "bg-primary-soft text-primary",
  PARITY: "bg-status-review-bg text-status-review-fg",
};

export function SegmentChip({ label, className }: { label: SegmentLabel; className?: string }) {
  return <span className={cn("inline-flex h-5 items-center rounded-full px-2 font-mono text-[11px] font-semibold tracking-[0.06em]", SEGMENT_CLASS[label], className)}>{label}</span>;
}

/** The segment a marker belongs to, read from its text ("(AFTER only)", "(parity)"). */
function markerSegment(text: string): SegmentLabel | null {
  if (/\bparity\b/i.test(text)) return "PARITY";
  if (/\bAFTER\b/.test(text)) return "AFTER";
  if (/\bBEFORE\b/.test(text)) return "BEFORE";
  return null;
}

export interface RecordingPlayerProps {
  item: Evidence;
  /** e.g. "CP-52202" for the overlay. */
  taskLabel?: string;
  /** Smaller: no marker list, just the player and the marker track (PO summary highlights). */
  compact?: boolean;
  className?: string;
}

export function RecordingPlayer({ item, taskLabel, compact, className }: RecordingPlayerProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState<number>(item.durationSec ?? 0);
  const markers = (item.timeline ?? []).map((m) => ({ ...m, sec: parseClock(m.t), segment: markerSegment(m.text) })).filter((m) => Number.isFinite(m.sec));
  const activeIdx = markers.reduce((acc, m, i) => (time + 0.25 >= m.sec ? i : acc), -1);

  const seek = (sec: number) => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = sec;
    setTime(sec);
    void v.play().catch(() => {});
  };

  if (!item.url) {
    return <p className="rounded-[16px] border border-dashed border-circle-border px-3 py-6 text-center text-sm text-muted-foreground">The recording file is not available.</p>;
  }

  return (
    <div className={cn("min-w-0 space-y-3", className)}>
      <div className="relative overflow-hidden rounded-[16px] bg-black shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_14px_30px_-16px_rgb(0_0_0/0.55)]">
        <video
          ref={ref}
          src={item.url}
          controls
          preload="metadata"
          playsInline
          className="aspect-video w-full bg-black"
          aria-label={`Recording: ${item.title}`}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDuration(d);
          }}
        />
        <div className="pointer-events-none absolute top-2.5 left-2.5 flex max-w-[calc(100%-1.25rem)] flex-wrap gap-1.5 font-mono text-[11px] leading-none text-white">
          {taskLabel ? <span className="rounded-full bg-black/55 px-2.5 py-1.5 ring-1 ring-white/15 backdrop-blur-md">{taskLabel}</span> : null}
          <span className="max-w-full truncate rounded-full bg-black/55 px-2.5 py-1.5 ring-1 ring-white/15 backdrop-blur-md">{item.environment}</span>
          {!compact ? <span className="max-w-full truncate rounded-full bg-black/55 px-2.5 py-1.5 ring-1 ring-white/15 backdrop-blur-md">build {item.build}</span> : null}
        </div>
      </div>

      {item.segments?.length ? (
        <ul className="flex flex-col gap-1" aria-label="Segments">
          {item.segments.map((s) => (
            <li key={`${s.label}-${s.host}`} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <SegmentChip label={s.label} />
              <span className="min-w-0 truncate font-mono text-xs text-foreground">{s.host}</span>
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={s.build}>
                {s.build}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {markers.length > 0 ? (
        <div className="space-y-2">
          <div className="relative h-6" aria-hidden={compact ? undefined : true}>
            <div className="bar-track absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full" />
            <div className="stripes absolute top-1/2 left-0 h-2 -translate-y-1/2 rounded-full [--c:var(--status-running-solid)]" style={{ width: duration ? `${Math.min(100, (time / duration) * 100)}%` : 0 }} />
            {markers.map((m, i) => (
              <button
                key={`${m.t}-${i}`}
                type="button"
                tabIndex={compact ? 0 : -1}
                onClick={() => seek(m.sec)}
                title={`${m.t} ${m.text}`}
                aria-label={`Seek to ${m.t}: ${m.text}`}
                className={cn(
                  "absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-field shadow-[0_1px_3px_rgb(0_0_0/0.3)] transition-transform duration-150 hover:scale-125 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  i <= activeIdx ? "bg-status-running-solid" : "bg-status-neutral-solid",
                )}
                style={{ left: duration ? `${Math.min(100, (m.sec / duration) * 100)}%` : `${((i + 1) / (markers.length + 1)) * 100}%` }}
              />
            ))}
          </div>
          {!compact ? (
            <ol className="space-y-0.5" aria-label="Timeline markers">
              {markers.map((m, i) => (
                <li key={`${m.t}-${i}`}>
                  <button
                    type="button"
                    onClick={() => seek(m.sec)}
                    aria-current={i === activeIdx ? "true" : undefined}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-[12px] px-2.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-foreground/[0.04] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                      i === activeIdx && "bg-status-running-bg hover:bg-status-running-bg",
                    )}
                  >
                    <span className="inline-flex shrink-0 items-center gap-1 font-mono text-xs text-primary tabular-nums">
                      <Play aria-hidden className="size-3" />
                      {m.t}
                    </span>
                    <span className="min-w-0 flex-1 text-heading">{m.text}</span>
                    {m.segment ? <SegmentChip label={m.segment} className="shrink-0" /> : null}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="font-mono text-xs text-muted-foreground tabular-nums">
              {clock(time)} / {clock(duration)} · {markers.length} markers
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
