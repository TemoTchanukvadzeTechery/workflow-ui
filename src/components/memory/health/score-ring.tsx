"use client";

/**
 * The vault health score as a ring (plan §3): a well-colored track and an arc of 45° stripes in
 * the band's tone (the striped bar's texture, STYLE.md 5) for score/100, with the number in the
 * middle. One labelled image for assistive tech; the band and counts are spelled out next to it.
 */
import { useId } from "react";
import type { MemoryHealthBand } from "@/lib/memory/types";
import { cn } from "@/lib/utils";
import { HEALTH_BAND_META, TONE_SOLID } from "./check-meta";

export interface ScoreRingProps {
  /** 0–100; null draws the empty track with a dash. */
  score: number | null;
  band: MemoryHealthBand | null;
  /** Diameter in px; default 152. */
  size?: number;
  className?: string;
}

export function ScoreRing({ score, band, size = 152, className }: ScoreRingProps) {
  const patternId = `score-stripes-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const thickness = Math.max(8, Math.round(size * 0.085));
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.min(100, Math.max(0, score)) / 100;
  const solid = TONE_SOLID[band ? HEALTH_BAND_META[band].tone : "neutral"];
  const label = score === null || !band ? "Vault health not scored yet" : `Vault health ${score} out of 100, ${HEALTH_BAND_META[band].label.toLowerCase()}`;
  const big = size >= 120;

  return (
    <div role="img" aria-label={label} className={cn("relative inline-grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="absolute inset-0">
        <defs>
          <pattern id={patternId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" style={{ fill: `color-mix(in srgb, ${solid} 62%, var(--stripe-mix))` }} />
            <rect width="3" height="5" style={{ fill: solid }} />
          </pattern>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness} style={{ stroke: "var(--well)" }} />
        {pct > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={`${c * pct} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className="transition-[stroke-dasharray] duration-700 ease-out motion-reduce:transition-none"
            style={{ stroke: `url(#${patternId})` }}
          />
        ) : null}
      </svg>
      <div className="relative flex flex-col items-center leading-none" aria-hidden>
        <span
          className={cn("font-normal tracking-[-0.045em] text-heading tabular-nums", score === null && "text-muted-numeral")}
          style={{ fontSize: Math.round(size * (big ? 0.3 : 0.32)) }}
        >
          {score ?? "–"}
        </span>
        <span className={cn("text-muted-foreground tabular-nums", big ? "mt-1.5 text-[13px]" : "mt-1 text-[11px]")}>of 100</span>
      </div>
    </div>
  );
}
