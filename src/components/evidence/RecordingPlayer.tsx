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
  return <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 font-mono text-[10.5px] font-semibold tracking-[0.08em]", SEGMENT_CLASS[label], className)}>{label}</span>;
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
    return <p className="rounded-lg border border-dashed px-3 py-6 text-center text-[13px] text-muted-foreground">The recording file is not available.</p>;
  }

  return (
    <div className={cn("min-w-0 space-y-3", className)}>
      <div className="relative overflow-hidden rounded-lg bg-black">
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
        <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-1 font-mono text-[10.5px] leading-none text-white">
          {taskLabel ? <span className="rounded bg-black/65 px-1.5 py-1">{taskLabel}</span> : null}
          <span className="max-w-full truncate rounded bg-black/65 px-1.5 py-1">{item.environment}</span>
          {!compact ? <span className="max-w-full truncate rounded bg-black/65 px-1.5 py-1">build {item.build}</span> : null}
        </div>
      </div>

      {item.segments?.length ? (
        <ul className="flex flex-col gap-1" aria-label="Segments">
          {item.segments.map((s) => (
            <li key={`${s.label}-${s.host}`} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <SegmentChip label={s.label} />
              <span className="min-w-0 truncate font-mono text-[11px] text-foreground">{s.host}</span>
              <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={s.build}>
                {s.build}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {markers.length > 0 ? (
        <div className="space-y-2">
          <div className="relative h-6" aria-hidden={compact ? undefined : true}>
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-foreground/[0.08]" />
            <div className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-primary" style={{ width: duration ? `${Math.min(100, (time / duration) * 100)}%` : 0 }} />
            {markers.map((m, i) => (
              <button
                key={`${m.t}-${i}`}
                type="button"
                tabIndex={compact ? 0 : -1}
                onClick={() => seek(m.sec)}
                title={`${m.t} ${m.text}`}
                aria-label={`Seek to ${m.t}: ${m.text}`}
                className={cn(
                  "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card transition-transform duration-150 hover:scale-125 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  i <= activeIdx ? "bg-primary" : "bg-muted-foreground",
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
                      "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      i === activeIdx && "bg-primary-soft",
                    )}
                  >
                    <span className="inline-flex shrink-0 items-center gap-1 font-mono text-xs text-primary tabular-nums">
                      <Play aria-hidden className="size-3" />
                      {m.t}
                    </span>
                    <span className="min-w-0 flex-1 text-foreground">{m.text}</span>
                    {m.segment ? <SegmentChip label={m.segment} className="shrink-0" /> : null}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {clock(time)} / {clock(duration)} · {markers.length} markers
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
