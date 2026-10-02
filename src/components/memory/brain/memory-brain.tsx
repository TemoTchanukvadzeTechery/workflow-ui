"use client";

/**
 * The living data brain in the /memory header (plan §2): the vault's notes are the neurons and
 * their links the synapses, placed inside an abstract side view of a brain seen from the left ear
 * (brain-shape.ts, place-neurons.ts): two soft lobes drawn as dotted contours with a glow and a
 * fainter echo, and one faint fold. Plain React SVG coloured with CSS variables only, so dark mode needs no code;
 * hairlines keep their width at every size (`vector-effect: non-scaling-stroke`).
 *
 * - Neurons: a muted mix of the note type's series colour; the five busiest notes are hubs
 *   (`--chart-1` with a halo), notes without links are dormant (faded), seed-blocked notes hollow.
 * - Pulses (lg and up): five signals, one in flight at a time over a 7.5 s cycle, each running a
 *   synapse from its quieter end to its busier one and firing a ring at the target. CSS
 *   `stroke-dashoffset` on copies of the paths, no JavaScript animation loop. The group is
 *   unmounted while the brain is off screen and hidden under `prefers-reduced-motion`.
 * - Interaction (lg and up): hover a neuron for a glass tooltip and its synapses lit; click opens
 *   the note (modified and middle clicks keep the native link behaviour). The whole figure is
 *   aria-hidden and the neurons are out of the tab order: the Table and Graph tabs list every
 *   note for keyboard and screen-reader users.
 * - Loading: the outline alone, with fixed box sizes, so nothing shifts; the neurons fade in
 *   when the graph arrives.
 */
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, useSyncExternalStore, type MouseEvent } from "react";
import { MEMORY_TYPE_COLOR } from "@/components/memory/stats-header";
import { MemoryTypeLabel } from "@/components/memory/status-meta";
import { formatNumber } from "@/lib/format";
import type { MemoryGraphPayload } from "@/lib/memory/types";
import { cn } from "@/lib/utils";
import { BRAIN_VIEWBOX, CENTROID, FOLD, LOBES } from "./brain-shape";
import { placeNeurons, type Neuron, type Pulse } from "./place-neurons";

const { w: VB_W, h: VB_H } = BRAIN_VIEWBOX;

/** A soft field rather than tissue: the card surface with a breath of the brand blue. */
const FIELD = "color-mix(in oklab, var(--card), var(--chart-1) 4%)";
const CONTOUR = "color-mix(in oklab, var(--muted-foreground) 55%, transparent)";
const ECHO_STROKE = "color-mix(in oklab, var(--chart-1) 45%, transparent)";
const FOLD_STROKE = "color-mix(in oklab, var(--muted-foreground) 32%, transparent)";

/**
 * A sparse dotted copy of the outline scaled out from the centroid: an aura that keeps the figure
 * abstract. It stays inside the page padding at every breakpoint (no horizontal scroll).
 */
const ECHOES = [{ scale: 1.06, opacity: 0.45 }] as const;
const scaleFromCentroid = (k: number) => `translate(${CENTROID.x} ${CENTROID.y}) scale(${k}) translate(${-CENTROID.x} ${-CENTROID.y})`;

/** Pulses: one slot each in a CYCLE_S cycle, so exactly one is in flight at a time. */
const PULSE_SLOTS = 5;
const CYCLE_S = 7.5;
const SLOT_S = CYCLE_S / PULSE_SLOTS;

/**
 * The pulse runs a 0.22-long dash (pathLength=1) from before the start to past the end in the
 * first 14% of the cycle (eased, so its head reaches the target at about 10%), when the ring at
 * the target fires. Stroke widths on the pulse are in viewBox units: a non-scaling stroke would
 * measure the dash pattern in screen space and break the pathLength mapping.
 */
const BRAIN_CSS = [
  "@keyframes memory-brain-pulse{0%{stroke-dashoffset:.22;opacity:0}2%{opacity:1}14%{stroke-dashoffset:-1;opacity:1}15%,100%{stroke-dashoffset:-1;opacity:0}}",
  "@keyframes memory-brain-fire{0%,8.5%{transform:scale(.7);opacity:0}10.5%{transform:scale(1);opacity:.85}20%,100%{transform:scale(2.4);opacity:0}}",
  `.memory-brain-pulse{fill:none;stroke:var(--chart-1);stroke-width:2.2;stroke-linecap:round;stroke-dasharray:.22 2;stroke-dashoffset:.22;opacity:0;animation:memory-brain-pulse ${CYCLE_S}s cubic-bezier(.45,0,.55,1) infinite}`,
  `.memory-brain-fire{fill:none;stroke:var(--chart-1);stroke-width:1.5;vector-effect:non-scaling-stroke;transform-box:fill-box;transform-origin:center;opacity:0;animation:memory-brain-fire ${CYCLE_S}s ease-out infinite}`,
].join("");

const neuronColor = (n: Neuron) => (n.hub ? "var(--chart-1)" : `color-mix(in oklab, ${MEMORY_TYPE_COLOR[n.node.type]} 40%, var(--muted-foreground))`);

/** True while `el` intersects the viewport (false until the first report, and without IntersectionObserver). */
function useOnScreen(el: Element | null): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setOn(entries.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, [el]);
  return on;
}

/**
 * Pulses run only at lg and up without reduced motion. A display:none group is not enough:
 * Chromium keeps ticking CSS animations on SVG descendants of a hidden group, so the pulses
 * are not mounted at all below lg. While the assistant is docked, lg needs 24rem more viewport
 * (the shifted breakpoints in globals.css), so the docked query applies then.
 */
const PULSE_QUERY = "(min-width: 64rem) and (prefers-reduced-motion: no-preference)";
const PULSE_QUERY_DOCKED = "(min-width: 88rem) and (prefers-reduced-motion: no-preference)";

function subscribePulseQuery(onChange: () => void) {
  const lists = [window.matchMedia(PULSE_QUERY), window.matchMedia(PULSE_QUERY_DOCKED)];
  for (const mql of lists) mql.addEventListener("change", onChange);
  const docking = new MutationObserver(onChange);
  docking.observe(document.documentElement, { attributes: true, attributeFilter: ["data-assistant"] });
  return () => {
    for (const mql of lists) mql.removeEventListener("change", onChange);
    docking.disconnect();
  };
}

function pulsesAllowedNow(): boolean {
  const docked = document.documentElement.dataset.assistant === "open";
  return window.matchMedia(PULSE_QUERY).matches && (!docked || window.matchMedia(PULSE_QUERY_DOCKED).matches);
}

function usePulsesAllowed(): boolean {
  return useSyncExternalStore(subscribePulseQuery, pulsesAllowedNow, () => false);
}

function Pulses({ pulses }: { pulses: readonly Pulse[] }) {
  return (
    <g>
      {pulses.map((p, i) => {
        // Pulse i owns slot i: a negative delay starts it that far into its cycle.
        const delay = { animationDelay: `${-(((PULSE_SLOTS - i) % PULSE_SLOTS) * SLOT_S)}s` };
        return (
          <g key={p.key}>
            <path d={p.d} pathLength={1} className="memory-brain-pulse" style={delay} />
            <circle cx={p.x} cy={p.y} r={p.r + 1.5} className="memory-brain-fire" style={delay} />
          </g>
        );
      })}
    </g>
  );
}

function Sep() {
  return <span className="text-muted-foreground/60">|</span>;
}

/**
 * GlassTooltip's surface and type, placed by the neuron's share of the box and anchored away from
 * the nearest edges (the brain sits at the page's right edge).
 */
function NeuronTooltip({ n }: { n: Neuron }) {
  const x = (n.x / VB_W) * 100;
  const y = (n.y / VB_H) * 100;
  const below = y < 36;
  const tx = x > 58 ? "calc(-100% + 18px)" : x < 26 ? "-18px" : "-50%";
  return (
    <div
      className="glass pointer-events-none absolute z-10 flex w-max max-w-60 flex-col gap-0.5 rounded-[16px] px-3.5 py-2 text-[13px] leading-5 text-muted-foreground"
      style={{
        left: `${x}%`,
        top: below ? `calc(${y}% + 14px)` : `calc(${y}% - 14px)`,
        transform: `translate(${tx}, ${below ? "0" : "-100%"})`,
      }}
    >
      <span className="font-medium break-words text-heading">{n.node.title}</span>
      <span className="flex flex-wrap items-center gap-x-1.5">
        <MemoryTypeLabel type={n.node.type} />
        <Sep />
        <span>
          <span className="font-medium text-heading tabular-nums">{formatNumber(n.node.linkCount)}</span> {n.node.linkCount === 1 ? "link" : "links"}
        </span>
      </span>
      {n.node.flags.seedBlocked && <span className="font-medium text-foreground">Seed blocked</span>}
    </div>
  );
}

export interface MemoryBrainProps {
  /** The neurons and synapses; undefined while loading (the silhouette alone). */
  graph?: MemoryGraphPayload;
  className?: string;
}

export function MemoryBrain({ graph, className }: MemoryBrainProps) {
  const router = useRouter();
  const tint = `${useId().replace(/[^\w-]/g, "")}-tint`;
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const onScreen = useOnScreen(box);
  const pulsesAllowed = usePulsesAllowed();
  const [active, setActive] = useState<string | null>(null);
  const layout = useMemo(() => (graph && graph.nodes.length > 0 ? placeNeurons(graph) : null), [graph]);

  const activeNeuron = active ? layout?.byId.get(active) : undefined;
  const lit = activeNeuron && layout ? (layout.neighbors.get(activeNeuron.id) ?? new Set<string>()) : null;
  const litSynapses = activeNeuron ? layout?.synapsesOf.get(activeNeuron.id) : undefined;

  const onClick = (e: MouseEvent, id: string) => {
    // Modified and middle clicks keep the native link behavior (new tab, etc.).
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    router.push(`/memory/${id}`);
  };
  const leave = (id: string) => setActive((a) => (a === id ? null : a));

  return (
    <div
      ref={setBox}
      aria-hidden
      className={cn("relative h-[162px] w-[232px] shrink-0 lg:h-[224px] lg:w-[320px] xl:h-[252px] xl:w-[360px]", className)}
    >
      <style href="memory-brain" precedence="default">
        {BRAIN_CSS}
      </style>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="100%" focusable="false" className="pointer-events-none block overflow-visible select-none">
        <defs>
          <radialGradient id={tint} cx="50%" cy="48%" r="62%">
            <stop offset="0" style={{ stopColor: "var(--chart-1)", stopOpacity: 0.1 }} />
            <stop offset="1" style={{ stopColor: "var(--chart-1)", stopOpacity: 0 }} />
          </radialGradient>
        </defs>

        <g fill="none" strokeWidth={1.6} strokeLinecap="round" strokeDasharray="0 12">
          {ECHOES.flatMap(({ scale, opacity }) =>
            LOBES.map((h, i) => (
              <path key={`${scale}:${i}`} d={h.d} transform={scaleFromCentroid(scale)} vectorEffect="non-scaling-stroke" style={{ stroke: ECHO_STROKE, opacity }} />
            )),
          )}
        </g>
        <g className="[filter:drop-shadow(0_12px_18px_rgb(0_0_0/0.05))] dark:[filter:none]">
          {LOBES.map((lobe, i) => (
            <g key={i}>
              <path d={lobe.d} stroke="none" style={{ fill: FIELD }} />
              {/* Gradient units are each lobe's own box, so each glows from its own middle. */}
              <path d={lobe.d} fill={`url(#${tint})`} stroke="none" />
              {/* Each lobe's contour right after its fill: the cerebrum, drawn last, covers the seam. */}
              <path d={lobe.d} fill="none" strokeWidth={2.2} strokeLinecap="round" strokeDasharray="0 6" vectorEffect="non-scaling-stroke" style={{ stroke: CONTOUR }} />
            </g>
          ))}
        </g>
        <path d={FOLD.d} fill="none" strokeWidth={1.8} strokeLinecap="round" strokeDasharray="0 7" vectorEffect="non-scaling-stroke" style={{ stroke: FOLD_STROKE }} />

        {layout && (
          <g className="animate-in duration-700 fade-in motion-reduce:animate-none">
            <path
              d={layout.synapsePath}
              fill="none"
              strokeWidth={0.9}
              vectorEffect="non-scaling-stroke"
              className="transition-opacity duration-150"
              style={{ stroke: "var(--muted-foreground)", opacity: activeNeuron ? 0.1 : 0.26 }}
            />
            {litSynapses && (
              <path d={litSynapses} fill="none" strokeWidth={1.3} vectorEffect="non-scaling-stroke" style={{ stroke: "var(--chart-1)", opacity: 0.85 }} />
            )}
            {onScreen && pulsesAllowed && layout.pulses.length > 0 && <Pulses pulses={layout.pulses} />}
            <g>
              {layout.neurons.map((n) => {
                const dim = !!activeNeuron && n.id !== activeNeuron.id && !lit?.has(n.id);
                const color = neuronColor(n);
                const hollow = n.node.flags.seedBlocked;
                return (
                  <a
                    key={n.id}
                    data-neuron
                    href={`/memory/${n.id}`}
                    tabIndex={-1}
                    className="cursor-pointer lg:pointer-events-auto"
                    onClick={(e) => onClick(e, n.id)}
                    onPointerEnter={() => setActive(n.id)}
                    onPointerLeave={() => leave(n.id)}
                  >
                    <g className={cn("transition-opacity duration-150", dim && "opacity-30")}>
                      {n.hub && <circle cx={n.x} cy={n.y} r={n.r + 4} style={{ fill: "var(--chart-1)", opacity: 0.14 }} />}
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={n.r}
                        strokeWidth={hollow ? 1.25 : 1}
                        vectorEffect="non-scaling-stroke"
                        style={{ fill: hollow ? FIELD : color, stroke: hollow ? color : FIELD, opacity: n.dormant && n.id !== active ? 0.45 : 1 }}
                      />
                      {n.id === active && (
                        <circle cx={n.x} cy={n.y} r={n.r + 2.5} fill="none" strokeWidth={1.25} vectorEffect="non-scaling-stroke" style={{ stroke: "var(--chart-1)" }} />
                      )}
                      <circle cx={n.x} cy={n.y} r={Math.max(n.r + 3, 6)} fill="transparent" />
                    </g>
                  </a>
                );
              })}
            </g>
          </g>
        )}
      </svg>
      {activeNeuron && <NeuronTooltip n={activeNeuron} />}
    </div>
  );
}
