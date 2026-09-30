"use client";

import { Lightbulb } from "lucide-react";
import Link from "next/link";
import { useId, useState, type FocusEvent } from "react";
import { cn } from "@/lib/utils";

export interface InsightItem {
  /** The big numeral: "75%", "3", "$4.20". */
  value: string;
  /** 16-18px white sentence under the numeral. */
  title: string;
  body?: string;
  /** Makes the title a link (and the card clickable). */
  href?: string;
}

export interface MeshInsightCardProps {
  items: InsightItem[];
  /** Time each insight shows before the next, in ms. Default 7000. Paused on hover and focus; off under reduced motion. */
  intervalMs?: number;
  /** Chip text. Default "Insights". */
  chipLabel?: string;
  className?: string;
}

/** Film grain: fractal noise as an SVG data URI, laid over the mesh at low opacity. */
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>",
)}")`;

/** Peach and coral top right, cream bottom right, into deep blue bottom left (STYLE.md 5). */
const MESH = [
  "radial-gradient(55% 48% at 100% 0%, #EE6A3A 0%, rgba(238,106,58,0) 82%)",
  "radial-gradient(60% 52% at 78% 12%, #F4935F 0%, rgba(244,147,95,0) 78%)",
  "radial-gradient(50% 45% at 100% 55%, #F7C48C 0%, rgba(247,196,140,0) 78%)",
  "radial-gradient(55% 45% at 96% 100%, #EFE6A6 0%, rgba(239,230,166,0) 78%)",
  "radial-gradient(42% 38% at 58% 100%, #8FD0FF 0%, rgba(143,208,255,0) 78%)",
  "radial-gradient(58% 58% at 0% 100%, #0B1648 0%, rgba(11,22,72,0) 72%)",
  "radial-gradient(60% 62% at 4% 72%, #1F47B8 0%, rgba(31,71,184,0) 78%)",
  "radial-gradient(55% 45% at 20% 50%, #2F6FD8 0%, rgba(47,111,216,0) 78%)",
  "radial-gradient(50% 40% at 0% 0%, #CBD7E4 0%, rgba(203,215,228,0) 80%)",
  "linear-gradient(135deg, #D2D6DC 0%, #B9B5B2 45%, #B4BCC0 70%, #DCD8B4 100%)",
].join(", ");

const FILL_KEYFRAMES = "@keyframes viz-insight-fill{from{transform:scaleX(0)}to{transform:scaleX(1)}}";

/**
 * The Insights card (STYLE.md 5): a grained mesh gradient with a glass frame, a white 72px numeral
 * and sentence, and a three-bar indicator. It rotates through `items` (the active bar fills over
 * `intervalMs`), pauses on hover or focus, and each bar jumps to its insight. The one loud
 * element on a page.
 */
export function MeshInsightCard({ items, intervalMs = 7000, chipLabel = "Insights", className }: MeshInsightCardProps) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const n = items.length;
  const i = n > 0 ? index % n : 0;
  const item = items[i];
  const paused = hovered || focused;
  const rotates = n > 1;
  const glassId = `${useId().replace(/:/g, "")}-glass`;

  const onBlur = (e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
  };

  return (
    <section
      aria-roledescription="carousel"
      aria-label={chipLabel}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={onBlur}
      className={cn("relative isolate flex min-h-[320px] flex-col overflow-hidden rounded-[28px] p-6 text-white shadow-[0_16px_36px_-18px_rgba(20,40,120,.45)]", className)}
    >
      <style href="viz-insight-fill" precedence="default">
        {FILL_KEYFRAMES}
      </style>
      <div aria-hidden className="absolute inset-0 -z-10" style={{ backgroundImage: MESH }} />
      {/* Glass frame in the top right corner, standing in for the reference's 3D glass shape. */}
      <svg aria-hidden viewBox="0 0 200 200" className="absolute -top-[34%] -right-[34%] -z-10 h-[112%] w-auto opacity-90">
        <defs>
          <linearGradient id={glassId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".55" />
            <stop offset=".5" stopColor="#fff" stopOpacity=".12" />
            <stop offset="1" stopColor="#fff" stopOpacity=".35" />
          </linearGradient>
        </defs>
        <rect x="40" y="40" width="120" height="120" rx="30" transform="rotate(45 100 100)" fill="none" stroke={`url(#${glassId})`} strokeWidth="26" />
        <rect x="27" y="27" width="146" height="146" rx="38" transform="rotate(45 100 100)" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1.2" />
        <rect x="53" y="53" width="94" height="94" rx="22" transform="rotate(45 100 100)" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="1" />
      </svg>
      {/* Scrim under the text keeps white type readable on the lighter corners. */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(20deg,rgba(8,18,60,.42)_0%,rgba(8,18,60,.12)_45%,transparent_70%)]" />
      <div aria-hidden className="absolute inset-0 -z-10 opacity-[.32] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />

      <span className="inline-flex h-8 w-fit items-center gap-1.5 rounded-full border border-white/40 bg-white/20 px-3 text-[13px] leading-none text-white backdrop-blur-md">
        <Lightbulb aria-hidden className="size-3.5" strokeWidth={1.75} />
        {chipLabel}
      </span>

      <div className="mt-auto pt-10">
        <div aria-live={paused || !rotates ? "polite" : "off"}>
        {item && (
          <div key={i} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${n}`} className="animate-in duration-500 fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
            <div className="text-[56px] leading-none font-normal tracking-[-0.045em] tabular-nums [text-shadow:0_2px_24px_rgba(10,20,70,.25)] sm:text-[72px]">{item.value}</div>
            <h3 className="mt-5 text-[18px] leading-6 font-medium tracking-[-0.01em] text-balance">
              {item.href ? (
                <Link href={item.href} className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-[28px] focus-visible:ring-3 focus-visible:ring-white/70">
                  {item.title}
                </Link>
              ) : (
                item.title
              )}
            </h3>
            {item.body && <p className="mt-3 text-[14px] leading-5 text-white/90">{item.body}</p>}
          </div>
        )}
        </div>

        {n > 1 && (
          <div className="relative z-10 mt-6 flex gap-2">
            {items.map((it, k) => {
              const on = k === i;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setIndex(k)}
                  aria-label={`Show insight ${k + 1} of ${n}: ${it.title}`}
                  aria-current={on ? "true" : undefined}
                  className="group/bar flex h-4 flex-1 items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                >
                  <span className="relative block h-[2px] w-full overflow-hidden rounded-full bg-white/40 transition-colors group-hover/bar:bg-white/60">
                    {on && (
                      <span
                        key={`${i}:${index}`}
                        className="absolute inset-0 origin-left rounded-full bg-white motion-reduce:[animation:none]!"
                        style={
                          rotates
                            ? {
                                animation: `viz-insight-fill ${intervalMs}ms linear both`,
                                animationPlayState: paused ? "paused" : "running",
                              }
                            : undefined
                        }
                        onAnimationEnd={() => setIndex((x) => (x + 1) % n)}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
