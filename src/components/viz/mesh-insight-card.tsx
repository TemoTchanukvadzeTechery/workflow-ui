"use client";

import { Lightbulb } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState, type CSSProperties, type FocusEvent } from "react";
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

/**
 * Film grain: high-contrast grey fractal noise (opaque, so `overlay` both lifts and darkens), laid
 * over the mesh at low opacity.
 */
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n' x='0' y='0'><feTurbulence type='fractalNoise' baseFrequency='.72' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/><feComponentTransfer><feFuncR type='linear' slope='2.6' intercept='-.8'/><feFuncG type='linear' slope='2.6' intercept='-.8'/><feFuncB type='linear' slope='2.6' intercept='-.8'/><feFuncA type='linear' slope='0' intercept='1'/></feComponentTransfer></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>",
)}")`;

/** Where the white text starts, in px up from the bottom, until it is measured. */
const DEFAULT_REACH = 260;
const R = "var(--mesh-reach)";

/**
 * Orange and peach top right, through cream and sky, into cobalt and navy at the bottom (STYLE.md 5,
 * sampled from the reference), in two layers. The cool layer is a vertical sweep whose blues are
 * anchored to the text: `--mesh-reach` (px up from the bottom that hold white type) stays blue deep
 * enough for white text to pass AA, whatever the card's height. The warm layer (the blooms and the
 * pale top left corner) is masked out below that line, so it never lightens the text.
 */
const MESH_COOL = [
  "radial-gradient(60% 48% at 100% 100%, #1C66C2 0%, rgba(28,102,194,0) 80%)",
  "radial-gradient(58% 58% at 0% 100%, #0B1648 0%, rgba(11,22,72,0) 72%)",
  "radial-gradient(72% 70% at 4% 72%, #1F47B8 0%, rgba(31,71,184,0) 78%)",
  "radial-gradient(70% 50% at 20% 48%, #2F6FD8 0%, rgba(47,111,216,0) 78%)",
  `linear-gradient(0deg, #0E1F6E 0px, #1D3FA6 calc(${R} * .35), #3566D2 calc(${R} * .83), #8FBCE8 max(calc(${R} + 30px), 44%), #F3D3A2 max(calc(${R} + 70px), 68%), #F5A777 max(calc(${R} + 100px), 84%), #F07A45 100%)`,
].join(", ");

const MESH_WARM = [
  "radial-gradient(55% 42% at 100% 0%, #EE6A3A 0%, rgba(238,106,58,0) 82%)",
  "radial-gradient(60% 46% at 76% 8%, #F4935F 0%, rgba(244,147,95,0) 78%)",
  "radial-gradient(48% 30% at 100% 36%, #F7CF96 0%, rgba(247,207,150,0) 78%)",
  "radial-gradient(52% 38% at 0% 0%, #B3C6DE 0%, rgba(179,198,222,0) 80%)",
].join(", ");

/** The same layers for dark mode: deeper navy and muted warm stops, so the card is not the brightest thing on a dark page. */
const MESH_COOL_DARK = [
  "radial-gradient(60% 48% at 100% 100%, #144C98 0%, rgba(20,76,152,0) 80%)",
  "radial-gradient(58% 58% at 0% 100%, #050B2C 0%, rgba(5,11,44,0) 72%)",
  "radial-gradient(72% 70% at 4% 72%, #142F86 0%, rgba(20,47,134,0) 78%)",
  "radial-gradient(70% 50% at 20% 48%, #1F4FA8 0%, rgba(31,79,168,0) 78%)",
  `linear-gradient(0deg, #0A1650 0px, #15317F calc(${R} * .35), #2556B0 calc(${R} * .83), #5F88B2 max(calc(${R} + 30px), 44%), #B09A78 max(calc(${R} + 70px), 68%), #C68A63 max(calc(${R} + 100px), 84%), #D0643A 100%)`,
].join(", ");

const MESH_WARM_DARK = [
  "radial-gradient(55% 42% at 100% 0%, #D05A2C 0%, rgba(208,90,44,0) 82%)",
  "radial-gradient(60% 46% at 76% 8%, #CF7A4C 0%, rgba(207,122,76,0) 78%)",
  "radial-gradient(48% 30% at 100% 36%, #B99266 0%, rgba(185,146,102,0) 78%)",
  "radial-gradient(52% 38% at 0% 0%, #5E708C 0%, rgba(94,112,140,0) 80%)",
].join(", ");

/** Hides a layer behind the text, fading in from the numeral (large type) to 50px above it. */
const ABOVE_TEXT = `linear-gradient(0deg, transparent calc(${R} - 60px), #000 calc(${R} + 50px))`;

export interface MeshBackdropProps {
  /** Draw the glass chevron in the top right corner. Default true. */
  glass?: boolean;
  className?: string;
}

/**
 * The Insights card's backdrop on its own: mesh gradient, glass chevron, a scrim under the text,
 * grain, and a dark-mode dimmer. Absolutely positioned layers at `-z-10`; the parent needs
 * `relative isolate overflow-hidden` and its radius. Mark the parent's bottom text block (a direct
 * child) with `data-mesh-text`: the backdrop measures it and keeps everything behind it deep blue,
 * so white type passes AA at any size (without it, the bottom 260px). Use it for any other "one
 * loud card" (the project overview's Next step card) so they match.
 */
export function MeshBackdrop({ glass = true, className }: MeshBackdropProps) {
  const glassId = `${useId().replace(/:/g, "")}-glass`;
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [reach, setReach] = useState(DEFAULT_REACH);

  // Measure from the card's bottom to the top of its text block, and follow resizes and slides.
  useEffect(() => {
    const text = root?.parentElement?.querySelector<HTMLElement>(":scope > [data-mesh-text]");
    if (!root || !text) return;
    const measure = () => {
      const top = text.getBoundingClientRect().top + (parseFloat(getComputedStyle(text).paddingTop) || 0);
      const r = Math.round(root.getBoundingClientRect().bottom - top) + 16;
      setReach((x) => (x === r ? x : r));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    ro.observe(text);
    return () => ro.disconnect();
  }, [root]);

  const vars = { "--mesh-reach": `${Math.max(reach, 180)}px` } as CSSProperties;
  return (
    <div ref={setRoot} aria-hidden className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit] [container-type:size]", className)} style={vars}>
      <div className="absolute inset-0 dark:hidden" style={{ backgroundImage: MESH_COOL }} />
      <div className="absolute inset-0 hidden dark:block" style={{ backgroundImage: MESH_COOL_DARK }} />
      <div className="absolute inset-0 dark:hidden" style={{ backgroundImage: MESH_WARM, maskImage: ABOVE_TEXT, WebkitMaskImage: ABOVE_TEXT }} />
      <div className="absolute inset-0 hidden dark:block" style={{ backgroundImage: MESH_WARM_DARK, maskImage: ABOVE_TEXT, WebkitMaskImage: ABOVE_TEXT }} />
      {/*
        Glass frame in the top right, standing in for the reference's 3D glass: a thick frosted
        rounded frame tilted 25deg, its corner pointing left at about 52% / 25% of a portrait card,
        with a bright white rim that fades along the arms and a faint pane inside. Sized to the
        card's shorter side, so a wide card keeps it in its corner, and faded out over the text.
      */}
      {glass && (
        <div className="absolute inset-0 dark:opacity-35" style={{ maskImage: ABOVE_TEXT, WebkitMaskImage: ABOVE_TEXT }}>
          <svg
            viewBox="0 0 400 400"
            className="absolute overflow-visible"
            style={{ width: "min(100cqw, 100cqh)", left: "calc(100cqw - 0.58 * min(100cqw, 100cqh))", top: "calc(-0.21 * min(100cqw, 100cqh))" }}
          >
            <defs>
              <linearGradient id={`${glassId}-band`} gradientUnits="userSpaceOnUse" x1="40" y1="200" x2="360" y2="40">
                <stop offset="0" stopColor="#fff" stopOpacity=".5" />
                <stop offset=".35" stopColor="#fff" stopOpacity=".16" />
                <stop offset="1" stopColor="#fff" stopOpacity=".08" />
              </linearGradient>
              <linearGradient id={`${glassId}-rim`} gradientUnits="userSpaceOnUse" x1="20" y1="220" x2="380" y2="0">
                <stop offset="0" stopColor="#fff" stopOpacity=".95" />
                <stop offset=".4" stopColor="#fff" stopOpacity=".7" />
                <stop offset="1" stopColor="#fff" stopOpacity=".25" />
              </linearGradient>
            </defs>
            <g transform="rotate(25 40 200)">
              <rect x="40" y="-100" width="420" height="300" rx="52" fill="#fff" fillOpacity=".05" stroke={`url(#${glassId}-band)`} strokeWidth="34" />
              <rect x="23" y="-117" width="454" height="334" rx="68" fill="none" stroke={`url(#${glassId}-rim)`} strokeWidth="1.5" />
              <rect x="57" y="-83" width="386" height="266" rx="36" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="1" />
              <rect x="150" y="-60" width="260" height="170" rx="30" fill="#fff" fillOpacity=".1" stroke="#fff" strokeOpacity=".35" strokeWidth="1" />
            </g>
          </svg>
        </div>
      )}
      {/* Scrim under the text keeps white type readable on the lighter corners. */}
      <div className="absolute inset-0 bg-[radial-gradient(115%_80%_at_0%_100%,rgba(8,18,60,.5)_0%,rgba(8,18,60,.2)_50%,transparent_78%),linear-gradient(0deg,rgba(8,18,60,.2)_0%,rgba(8,18,60,.12)_var(--mesh-reach),transparent_calc(var(--mesh-reach)+60px))]" />
      <div className="absolute inset-0 opacity-[.2] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
      <div className="absolute inset-0 hidden bg-[rgba(8,12,36,.28)] dark:block" />
    </div>
  );
}

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
      <MeshBackdrop />

      <span className="inline-flex h-8 w-fit items-center gap-1.5 rounded-full border border-white/50 bg-white/25 px-3 text-[13px] leading-none text-[#3F3A3A] shadow-[inset_0_1px_0_rgba(255,255,255,.5)] backdrop-blur-md dark:border-white/25 dark:bg-white/10 dark:text-white dark:shadow-[inset_0_1px_0_rgba(255,255,255,.18)]">
        <Lightbulb aria-hidden className="size-3.5" strokeWidth={1.75} />
        {chipLabel}
      </span>

      <div data-mesh-text className="mt-auto pt-10">
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
