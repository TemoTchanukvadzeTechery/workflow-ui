"use client";

/**
 * HTML5 player for a recorded agent session (Plexus web-recording style): a poster with a play
 * circle until it is played, overlay facts (task, build, environment), Before / After / Parity
 * segment tags, and mm:ss timeline markers that seek the video. The active marker follows playback.
 */
import { Play } from "lucide-react";
import { useRef, useState } from "react";
import type { Evidence } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { clock, parseClock } from "./utils";

type SegmentLabel = "BEFORE" | "AFTER" | "PARITY";

const SEGMENT_CLASS: Record<SegmentLabel, string> = {
  BEFORE: "bg-status-neutral-bg text-status-neutral-fg",
  AFTER: "bg-status-running-bg text-status-running-fg",
  PARITY: "bg-status-review-bg text-status-review-fg",
};

const SEGMENT_TEXT: Record<SegmentLabel, string> = { BEFORE: "Before", AFTER: "After", PARITY: "Parity" };

/** A soft sentence-case tag for a recording segment ("After", "Parity"). */
export function SegmentChip({ label, className }: { label: SegmentLabel; className?: string }) {
  return <span className={cn("inline-flex h-6 shrink-0 items-center rounded-full px-2 text-xs leading-none font-medium", SEGMENT_CLASS[label], className)}>{SEGMENT_TEXT[label]}</span>;
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

  // Until it is played the video is a poster: its first frame (or the well gradient while that
  // loads) under a centred play circle, with no native controls.
  const [started, setStarted] = useState(false);

  const play = () => {
    setStarted(true);
    void ref.current?.play().catch(() => {});
  };

  const seek = (sec: number) => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = sec;
    setTime(sec);
    play();
  };

  if (!item.url) {
    return <p className="rounded-[20px] border border-dashed border-circle-border px-3 py-6 text-center text-sm text-muted-foreground">The recording file is not available.</p>;
  }

  const chip = "rounded-full bg-white/80 px-2.5 py-1.5 text-[#1a1a1a] shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_4px_10px_-4px_rgb(0_0_0/0.3)] backdrop-blur-md";

  return (
    <div className={cn("min-w-0 space-y-3", className)}>
      <div className="relative overflow-hidden rounded-[20px] bg-linear-to-b from-well to-[color-mix(in_srgb,var(--well)_70%,var(--card))] shadow-[0_0_0_1px_var(--rule)]">
        <video
          ref={ref}
          src={item.url}
          controls={started}
          preload="metadata"
          playsInline
          className="block aspect-video w-full"
          aria-label={`Recording: ${item.title}`}
          onPlay={() => setStarted(true)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDuration(d);
          }}
        />
        {!started ? (
          <button
            type="button"
            onClick={play}
            aria-label={`Play recording: ${item.title}`}
            className="group/play absolute inset-0 flex items-center justify-center bg-black/[0.04] outline-none"
          >
            <span className="inline-flex size-14 items-center justify-center rounded-full bg-white text-[#0b0b0b] shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_10px_24px_-8px_rgb(0_0_0/0.45)] transition-transform duration-150 group-hover/play:scale-105 group-focus-visible/play:ring-4 group-focus-visible/play:ring-ring/60">
              <Play aria-hidden className="ml-0.5 size-[22px] fill-current" strokeWidth={1.75} />
            </span>
            {item.durationSec ? <span className={cn(chip, "absolute right-2.5 bottom-2.5 text-xs leading-none tabular-nums")}>{clock(item.durationSec)}</span> : null}
          </button>
        ) : null}
        <div className="pointer-events-none absolute top-2.5 left-2.5 flex max-w-[calc(100%-1.25rem)] flex-wrap gap-1.5 font-mono text-[11px] leading-none">
          {taskLabel ? <span className={chip}>{taskLabel}</span> : null}
          <span className={cn(chip, "max-w-full truncate")}>{item.environment}</span>
          {!compact ? <span className={cn(chip, "max-w-full truncate")}>build {item.build}</span> : null}
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
                    <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-primary tabular-nums">
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
            <p className="text-xs text-muted-foreground tabular-nums">
              {clock(time)} / {clock(duration)} · {markers.length} markers
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
