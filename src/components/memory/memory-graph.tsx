"use client";

/**
 * The memory vault as a node-link map (plan A5): d3-force layout run to rest synchronously (see
 * graph-layout.ts), drawn as plain React SVG with no animation loop. Node fill = note type (with a
 * legend); status is a decoration, never color alone — proposed = dashed ring, deprecated/retired =
 * hollow, seed blocked = "!" badge, drifted document = warning triangle; radius grows with links.
 * Edges: depends_on solid + arrow at the dependency, consumers the same arrow drawn from the
 * provider's end, related dotted, other frontmatter links dashed, body mentions a faint hairline.
 * `interactive`: hover or focus a note to light it and its neighbors (the rest dims) with a glass
 * tooltip; click or Enter opens it. `focusId` makes an ego view: notes within `hops` of the focus,
 * which is ringed and pinned at the center; it renders nothing when the focus has no neighbors.
 */
import { useRouter } from "next/navigation";
import { useDeferredValue, useId, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useElementSize } from "@/components/viz/use-element-size";
import { formatNumber, plural } from "@/lib/format";
import type { MemoryGraphPayload, MemoryNoteType } from "@/lib/memory/types";
import { cn } from "@/lib/utils";
import { GraphLegend, NodeMark } from "./graph-legend";
import {
  EDGE_LOOK,
  NODE_MARKS,
  edgePath,
  filterGraph,
  fitView,
  layoutGraph,
  placeLabels,
  screenPoint,
  spacingFor,
  type GraphView,
  type LayoutNode,
} from "./graph-layout";
import { MEMORY_TYPE_META, MemoryTypeLabel, noteStatusMeta } from "./status-meta";

/**
 * Title candidates: notes with at least this many links, the focus, and every note of an ego view
 * up to EGO_LABEL_ALL notes. placeLabels drops any that would collide; hover shows the rest.
 */
const LABEL_MIN_LINKS = 4;
const EGO_LABEL_ALL = 8;
const LABEL_FONT = 11;
const LABEL_OFFSET = 12;
const LABEL_CHARS = 26;
/** Screen px kept free around the cloud for titles. */
const PAD = { x: 48, top: 18, bottom: 30 };
/** Never zoom past this many px per layout unit (a tiny ego graph stays small). */
const MAX_SCALE = 1.6;
const SUMMARY_CHARS = 120;

export interface MemoryGraphProps {
  data: MemoryGraphPayload;
  /** Ego view around this note id. */
  focusId?: string;
  hops?: 1 | 2;
  /** Show only these types (the focus note always stays). Omit for all. */
  typeFilter?: ReadonlySet<MemoryNoteType>;
  hideUnconnected?: boolean;
  /** Note summaries by id for the tooltip (the graph payload carries none). */
  summaries?: Readonly<Record<string, string>>;
  /** Canvas height in px; or size it with `canvasClassName` (e.g. responsive heights). Default 420. */
  height?: number;
  canvasClassName?: string;
  interactive?: boolean;
  /** The type / edge / status key under the canvas (default on). */
  legend?: boolean;
  className?: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** "api-proxy, System, seed blocked": title and type always; status and marks when present. */
function nodeLabel(d: LayoutNode, focus: boolean): string {
  const n = d.node;
  const parts = [n.title, MEMORY_TYPE_META[n.type].label];
  if (n.status && n.status !== "active") parts.push(noteStatusMeta(n.status).label.toLowerCase());
  for (const m of NODE_MARKS) if (m.mark !== "proposed" && m.mark !== "retired" && m.test(n)) parts.push(m.label.toLowerCase());
  if (n.flags.hasProposed) parts.push("has proposed claims");
  if (focus) parts.push("this note");
  return parts.join(", ");
}

function Sep() {
  return (
    <span aria-hidden className="text-muted-foreground/60">
      |
    </span>
  );
}

/** GlassTooltip's surface and type (13px, muted labels, ink values, "|" separators), kept inside the canvas. */
function NodeTooltip({ id, d, view, width, summary }: { id: string; d: LayoutNode; view: GraphView; width: number; summary?: string }) {
  const p = screenPoint(view, d.x, d.y);
  const r = d.r * view.k;
  const below = p.y - r < 110;
  const n = d.node;
  const notes = [
    n.status && n.status !== "active" ? noteStatusMeta(n.status).label : null,
    ...NODE_MARKS.filter((m) => m.mark !== "proposed" && m.mark !== "retired" && m.test(n)).map((m) => m.label),
    n.flags.hasProposed ? "Has proposed claims" : null,
  ].filter((s): s is string => !!s);
  return (
    <div
      id={id}
      role="tooltip"
      className="glass pointer-events-none absolute z-10 flex w-max flex-col gap-0.5 rounded-[16px] px-3.5 py-2 text-[13px] leading-5 text-muted-foreground"
      style={{
        left: p.x,
        top: below ? p.y + r + 10 : p.y - r - 10,
        maxWidth: Math.max(160, Math.min(288, width - 16)),
        // Centered on the note, clamped to 8px inside the canvas; % is the tooltip's own width.
        transform: `translate(clamp(${8 - p.x}px, -50%, calc(${width - 8 - p.x}px - 100%)), ${below ? "0" : "-100%"})`,
      }}
    >
      <span className="font-medium text-heading">{n.title}</span>
      <span className="flex flex-wrap items-center gap-x-1.5">
        <MemoryTypeLabel type={n.type} />
        <Sep />
        <span>
          <span className="font-medium text-heading tabular-nums">{formatNumber(n.linkCount)}</span> {n.linkCount === 1 ? "link" : "links"}
        </span>
        <Sep />
        <span>
          <span className="font-medium text-heading tabular-nums">{formatNumber(n.claimCount)}</span> {n.claimCount === 1 ? "claim" : "claims"}
        </span>
      </span>
      {notes.length > 0 && <span className="font-medium text-foreground">{notes.join(" · ")}</span>}
      {summary ? <span className="text-foreground">{clip(summary, SUMMARY_CHARS)}</span> : null}
    </div>
  );
}

export function MemoryGraph({
  data,
  focusId,
  hops = 1,
  typeFilter,
  hideUnconnected = false,
  summaries,
  height,
  canvasClassName,
  interactive = false,
  legend = true,
  className,
}: MemoryGraphProps) {
  const router = useRouter();
  const uid = useId().replace(/[^\w-]/g, "");
  const [boxRef, size] = useElementSize<HTMLDivElement>();
  const [active, setActive] = useState<string | null>(null);
  const ego = focusId !== undefined;

  // Deferred so a filter click paints before the (tens of ms) relayout.
  const typeKey = useDeferredValue(typeFilter && typeFilter.size > 0 ? [...typeFilter].sort().join(",") : "");
  const hide = useDeferredValue(hideUnconnected);
  const visible = useMemo(
    () => filterGraph(data, { focusId, hops, hideUnconnected: hide, types: typeKey ? new Set(typeKey.split(",") as MemoryNoteType[]) : undefined }),
    [data, focusId, hops, hide, typeKey],
  );
  // Shape and spacing follow the padded canvas, bucketed so small resizes keep the layout;
  // fitView then rescales to the exact size.
  const measured = size.width > 0 && size.height > 0;
  const availW = Math.max(size.width - 2 * PAD.x, 1);
  const availH = Math.max(size.height - PAD.top - PAD.bottom, 1);
  const aspect = measured ? Math.min(3, Math.max(0.75, Math.round((availW / availH) * 2) / 2)) : 0;
  const spacing = measured ? spacingFor(visible.nodes.length, availW, availH) : 0;
  const labelAll = ego && visible.nodes.length <= EGO_LABEL_ALL;
  const layout = useMemo(
    () => (aspect > 0 && visible.nodes.length > 0 ? layoutGraph(visible, { focusId, aspect, spacing, roomy: labelAll }) : null),
    [visible, focusId, aspect, spacing, labelAll],
  );
  const view = layout ? fitView(layout.bounds, size.width, size.height, PAD, MAX_SCALE) : null;

  if (ego && visible.nodes.length <= 1) return null;

  const u = view ? 1 / view.k : 1;
  const activeNode = active && layout ? layout.byId.get(active) : undefined;
  const lit = activeNode && layout ? new Set([activeNode.id, ...(layout.neighbors.get(activeNode.id) ?? [])]) : null;
  const focusTitle = ego ? (data.nodes.find((n) => n.id === focusId)?.title ?? focusId) : "";
  const descId = `${uid}-desc`;
  const tipId = `${uid}-tip`;
  const title = (d: LayoutNode) => clip(d.node.title, LABEL_CHARS);
  const candidates = layout
    ? layout.nodes
        .filter((d) => labelAll || d.id === focusId || d.node.linkCount >= LABEL_MIN_LINKS)
        .sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId) || b.node.linkCount - a.node.linkCount || a.node.title.localeCompare(b.node.title))
    : [];
  const titled = layout && view ? placeLabels(candidates, layout.nodes, view, title, { fontPx: LABEL_FONT, offsetPx: LABEL_OFFSET }) : new Set<string>();
  // Lit titles always show, last, so they sit on top of the others.
  const labelled = layout ? layout.nodes.filter((d) => titled.has(d.id) || !!lit?.has(d.id)).sort((a, b) => Number(!!lit?.has(a.id)) - Number(!!lit?.has(b.id))) : [];

  const open = (id: string) => router.push(`/memory/${id}`);
  const onClick = (e: MouseEvent, id: string) => {
    // Modified and middle clicks keep the native link behavior (new tab, etc.).
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    open(id);
  };
  const onKeyDown = (e: KeyboardEvent, id: string) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    open(id);
  };
  const leave = (id: string) => setActive((a) => (a === id ? null : a));

  return (
    <figure className={cn("flex min-w-0 flex-col gap-4", className)}>
      <div
        ref={boxRef}
        className={cn("relative w-full min-w-0", canvasClassName)}
        style={height !== undefined || !canvasClassName ? { height: height ?? 420 } : undefined}
      >
        {visible.nodes.length === 0 && (
          <p className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">No notes match these filters.</p>
        )}
        {layout && view && (
          <svg
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            width="100%"
            height="100%"
            role={interactive ? "group" : "img"}
            aria-label={ego ? `Connections of ${focusTitle}` : "Memory graph"}
            aria-describedby={descId}
            className="block select-none"
          >
            <defs>
              {(["arrow", "arrow-on"] as const).map((m) => (
                <marker key={m} id={`${uid}-${m}`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
                  <path d="M0,1L9,5L0,9Z" style={{ fill: m === "arrow" ? "var(--muted-foreground)" : "var(--heading)" }} />
                </marker>
              ))}
            </defs>
            <g fill="none" aria-hidden>
              {layout.edges.map((e) => {
                const d = edgePath(e, 2 * u);
                if (!d) return null;
                const look = EDGE_LOOK[e.style];
                const on = !!activeNode && (e.source.id === activeNode.id || e.target.id === activeNode.id);
                const marker = e.arrow ? `url(#${uid}-${on ? "arrow-on" : "arrow"})` : undefined;
                return (
                  <path
                    key={e.key}
                    d={d}
                    strokeWidth={look.width * u * (on ? 1.3 : 1)}
                    strokeDasharray={look.dash?.map((v) => v * u).join(" ")}
                    strokeLinecap={look.round ? "round" : "butt"}
                    markerEnd={e.arrow === "end" ? marker : undefined}
                    markerStart={e.arrow === "start" ? marker : undefined}
                    opacity={lit ? (on ? 0.95 : 0.1) : look.opacity}
                    className="transition-opacity duration-150"
                    style={{ stroke: on ? "var(--heading)" : "var(--muted-foreground)" }}
                  />
                );
              })}
            </g>
            <g>
              {layout.nodes.map((d) => {
                const focus = d.id === focusId;
                const body = (
                  <g
                    transform={`translate(${Math.round(d.x * 10) / 10},${Math.round(d.y * 10) / 10})`}
                    className={cn("transition-opacity duration-150", lit && !lit.has(d.id) && "opacity-25")}
                  >
                    {interactive && (
                      <>
                        <circle r={d.r + 5 * u} fill="transparent" />
                        <circle
                          r={d.r + 7 * u}
                          fill="none"
                          strokeWidth={2.5 * u}
                          className="opacity-0 group-focus-visible:opacity-100"
                          style={{ stroke: "color-mix(in srgb, var(--ring) 60%, transparent)" }}
                        />
                      </>
                    )}
                    <NodeMark d={d} u={u} focus={focus} />
                  </g>
                );
                if (!interactive) return <g key={d.id}>{body}</g>;
                return (
                  <a
                    key={d.id}
                    href={`/memory/${d.id}`}
                    tabIndex={0}
                    aria-label={nodeLabel(d, focus)}
                    aria-describedby={active === d.id ? tipId : undefined}
                    aria-current={focus ? "page" : undefined}
                    className="group cursor-pointer outline-none"
                    onClick={(e) => onClick(e, d.id)}
                    onKeyDown={(e) => onKeyDown(e, d.id)}
                    onPointerEnter={() => setActive(d.id)}
                    onPointerLeave={() => leave(d.id)}
                    onFocus={() => setActive(d.id)}
                    onBlur={() => leave(d.id)}
                  >
                    {body}
                  </a>
                );
              })}
            </g>
            <g aria-hidden pointerEvents="none">
              {labelled.map((d) => {
                const strong = d.id === focusId || !!lit?.has(d.id);
                return (
                  <text
                    key={d.id}
                    x={Math.round(d.x * 10) / 10}
                    y={d.y + d.r + LABEL_OFFSET * u}
                    textAnchor="middle"
                    fontSize={LABEL_FONT * u}
                    fontWeight={strong ? 500 : 400}
                    paintOrder="stroke"
                    strokeWidth={3 * u}
                    strokeLinejoin="round"
                    className={cn("transition-opacity duration-150", lit && !lit.has(d.id) && "opacity-25")}
                    style={{ fill: strong ? "var(--heading)" : "var(--muted-foreground)", stroke: "var(--card)" }}
                  >
                    {title(d)}
                  </text>
                );
              })}
            </g>
          </svg>
        )}
        {interactive && activeNode && view && (
          <NodeTooltip id={tipId} d={activeNode} view={view} width={size.width} summary={summaries?.[activeNode.id]} />
        )}
      </div>
      <figcaption id={descId} className="sr-only">
        {plural(visible.nodes.length, "note")}, {plural(visible.edges.length, "connection")}
        {ego ? ` within ${hops === 1 ? "one hop" : "two hops"} of ${focusTitle}` : ""}.
        {interactive ? " Each note is a link to its page." : ""}
        {!ego && visible.hiddenUnconnected > 0 ? ` ${plural(visible.hiddenUnconnected, "unconnected note")} hidden.` : ""}
      </figcaption>
      {legend && layout && <GraphLegend layout={layout} />}
    </figure>
  );
}
