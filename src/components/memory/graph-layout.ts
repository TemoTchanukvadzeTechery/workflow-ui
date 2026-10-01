/**
 * Pure helpers behind MemoryGraph (plan A5): which notes and edges to show (type set, ego hops,
 * unconnected notes), how each edge is drawn (style, arrow end, dedupe, a bow for parallel edges),
 * a d3-force layout run to convergence synchronously (no animation loop, no idle CPU) and the
 * viewBox fit. Initial positions come from a hash of the note id and the simulation's random
 * source is a fixed-seed LCG, so a layout is identical across renders and a note keeps roughly its
 * place when a filter changes. React-free.
 */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import type { MemoryGraphEdge, MemoryGraphNode, MemoryGraphPayload, MemoryNoteType } from "@/lib/memory/types";

// ---------------------------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------------------------

export interface GraphFilter {
  types?: ReadonlySet<MemoryNoteType>;
  /** Ego view: keep notes within `hops` undirected hops of this note. */
  focusId?: string;
  hops?: 1 | 2;
  /** Drop notes with no visible edge (the focus note always stays). */
  hideUnconnected?: boolean;
}

export interface VisibleGraph {
  /** Sorted by id, so the simulation sees the same order whatever the payload order. */
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  /** How many notes `hideUnconnected` removed. */
  hiddenUnconnected: number;
}

/** Undirected adjacency. */
export function neighborMap(edges: ReadonlyArray<{ from: string; to: string }>): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    const s = m.get(a) ?? new Set<string>();
    s.add(b);
    m.set(a, s);
  };
  for (const e of edges) {
    add(e.from, e.to);
    add(e.to, e.from);
  }
  return m;
}

export function filterGraph(data: MemoryGraphPayload, { types, focusId, hops = 1, hideUnconnected }: GraphFilter): VisibleGraph {
  let keep = new Set(data.nodes.filter((n) => !types || types.has(n.type) || n.id === focusId).map((n) => n.id));
  let edges = data.edges.filter((e) => e.from !== e.to && keep.has(e.from) && keep.has(e.to));
  if (focusId !== undefined) {
    if (!keep.has(focusId)) return { nodes: [], edges: [], hiddenUnconnected: 0 };
    const adj = neighborMap(edges);
    const reach = new Set([focusId]);
    let frontier = [focusId];
    for (let h = 0; h < hops; h++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const m of adj.get(id) ?? []) {
          if (reach.has(m)) continue;
          reach.add(m);
          next.push(m);
        }
      }
      frontier = next;
    }
    keep = reach;
    edges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  }
  let hiddenUnconnected = 0;
  if (hideUnconnected) {
    const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
    if (focusId !== undefined) linked.add(focusId);
    for (const id of [...keep]) {
      if (linked.has(id)) continue;
      keep.delete(id);
      hiddenUnconnected++;
    }
  }
  const nodes = data.nodes.filter((n) => keep.has(n.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { nodes, edges, hiddenUnconnected };
}

// ---------------------------------------------------------------------------------------------
// Edge and node encoding (shared with the legend)
// ---------------------------------------------------------------------------------------------

export type EdgeStyle = "dependency" | "related" | "other" | "mention";

export const EDGE_STYLES: readonly EdgeStyle[] = ["dependency", "related", "other", "mention"];

/** Screen px (the component converts to viewBox units). `dash` is a px dash array. */
export const EDGE_LOOK: Record<EdgeStyle, { width: number; opacity: number; dash?: readonly [number, number]; round?: boolean }> = {
  dependency: { width: 1.3, opacity: 0.75 },
  related: { width: 1.7, opacity: 0.7, dash: [0.01, 3.6], round: true },
  other: { width: 1.1, opacity: 0.65, dash: [5, 3.5] },
  mention: { width: 0.75, opacity: 0.4 },
};

export const EDGE_LABEL: Record<EdgeStyle, { label: string; hint: string }> = {
  dependency: { label: "Depends on", hint: "depends_on and consumers links; the arrow points at the note depended on" },
  related: { label: "Related", hint: "related links (no direction)" },
  other: { label: "Other link", hint: "Other frontmatter links, such as owner, projects or documents" },
  mention: { label: "Mentioned in text", hint: "A wikilink in the note body" },
};

export function edgeStyleOf(property: string | null): EdgeStyle {
  if (property === null) return "mention";
  if (property === "depends_on" || property === "consumers") return "dependency";
  return property === "related" ? "related" : "other";
}

export type NodeMark = "proposed" | "retired" | "seedBlocked" | "drifted";

/** Status decorations (never color alone): which notes earn which mark. */
export const NODE_MARKS: ReadonlyArray<{ mark: NodeMark; label: string; test: (n: MemoryGraphNode) => boolean }> = [
  { mark: "proposed", label: "Proposed", test: (n) => n.status === "proposed" || n.flags.hasProposed },
  { mark: "retired", label: "Deprecated or retired", test: (n) => n.status === "deprecated" || n.status === "retired" },
  { mark: "seedBlocked", label: "Seed blocked", test: (n) => n.flags.seedBlocked },
  { mark: "drifted", label: "Drifted document", test: (n) => n.flags.isStaleDoc },
];

export function hasMark(n: MemoryGraphNode, mark: NodeMark): boolean {
  return NODE_MARKS.some((m) => m.mark === mark && m.test(n));
}

/** Radius grows with the square root of the link count (area reads as degree), 5..14. */
export function nodeRadius(linkCount: number): number {
  return Math.min(14, Math.max(5, 5 + 2.6 * Math.sqrt(Math.max(0, linkCount))));
}

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

export interface LayoutNode extends SimulationNodeDatum {
  id: string;
  node: MemoryGraphNode;
  r: number;
  x: number;
  y: number;
}

export interface LayoutEdge {
  key: string;
  /** Drawn from source to target. */
  source: LayoutNode;
  target: LayoutNode;
  style: EdgeStyle;
  /** `end` for depends_on (arrow at the dependency), `start` for consumers (arrow at the provider). */
  arrow: "start" | "end" | null;
  /** The properties folded into this one line ("mention" for body links). */
  properties: string[];
  /** Sideways bow in layout units; 0 = straight. */
  bend: number;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface GraphLayout {
  nodes: LayoutNode[];
  byId: Map<string, LayoutNode>;
  edges: LayoutEdge[];
  neighbors: Map<string, Set<string>>;
  bounds: Bounds;
}

const STYLE_RANK: Record<EdgeStyle, number> = { mention: 0, related: 1, other: 2, dependency: 3 };
const BEND_STEP = 10;

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** FNV-1a, as a fraction in [0, 1). */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

/** d3's own LCG constants, with a fixed seed. */
export function lcg(seed = 1): () => number {
  let s = seed;
  return () => (s = (1664525 * s + 1013904223) % 4294967296) / 4294967296;
}

/**
 * One line per visible fact: `a depends_on b` and `b consumers a` say the same thing and both draw
 * an arrow at b; undirected styles fold both directions into one line. Lines that still share a
 * pair (a dependency plus a related link, say) bow apart.
 */
function visualEdges(raw: readonly MemoryGraphEdge[], byId: Map<string, LayoutNode>): LayoutEdge[] {
  const byKey = new Map<string, LayoutEdge>();
  for (const e of raw) {
    const source = byId.get(e.from);
    const target = byId.get(e.to);
    if (!source || !target) continue;
    const style = edgeStyleOf(e.property);
    const consumers = e.property === "consumers";
    const key = style === "dependency" ? (consumers ? `dep:${e.to}>${e.from}` : `dep:${e.from}>${e.to}`) : `${style}:${pairKey(e.from, e.to)}`;
    const property = e.property ?? "mention";
    const hit = byKey.get(key);
    if (hit) {
      if (!hit.properties.includes(property)) hit.properties.push(property);
      continue;
    }
    byKey.set(key, { key, source, target, style, arrow: style === "dependency" ? (consumers ? "start" : "end") : null, properties: [property], bend: 0 });
  }
  const edges = [...byKey.values()].sort((a, b) => STYLE_RANK[a.style] - STYLE_RANK[b.style] || (a.key < b.key ? -1 : 1));
  const byPair = new Map<string, LayoutEdge[]>();
  for (const e of edges) {
    const k = pairKey(e.source.id, e.target.id);
    byPair.set(k, [...(byPair.get(k) ?? []), e]);
  }
  for (const group of byPair.values()) {
    if (group.length < 2) continue;
    group.forEach((e, i) => {
      const offset = (i - (group.length - 1) / 2) * BEND_STEP;
      // Measured on the pair's canonical direction, so reversed lines still land on distinct sides.
      e.bend = e.source.id < e.target.id ? offset : -offset;
    });
  }
  return edges;
}

export interface LayoutOptions {
  /** Pinned at the origin. */
  focusId?: string;
  /** Target width / height; the centering forces stretch the cloud to it. */
  aspect: number;
  /** Rim-to-rim link length in layout units (≈ px at scale 1); see `spacingFor`. Default 30. */
  spacing?: number;
  /** Extra room between notes (every title is shown, e.g. the ego view). */
  roomy?: boolean;
}

/**
 * Link length that makes `n` notes fill a `width` × `height` px area at roughly scale 1, so node
 * radii (5..14) read as px on any screen: tighter on a phone, looser on a wide desktop card.
 * Quantized to 4 so small resizes keep the layout.
 */
export function spacingFor(n: number, width: number, height: number): number {
  const perNote = Math.sqrt((Math.max(width, 1) * Math.max(height, 1)) / Math.max(n, 6));
  return Math.min(72, Math.max(18, Math.round((perNote * 0.42) / 4) * 4));
}

type Spring = SimulationLinkDatum<LayoutNode>;

export function layoutGraph(g: VisibleGraph, { focusId, aspect, spacing = 30, roomy = false }: LayoutOptions): GraphLayout {
  const link = spacing + (roomy ? 14 : 0);
  // Many-body repulsion falls off as 1/d, so holding the shape while scaling lengths by s takes s².
  const charge = -110 * (link / 30) ** 2;
  const spread = (link / 2) * Math.sqrt(g.nodes.length + 1);
  const stretch = Math.sqrt(aspect);
  const nodes: LayoutNode[] = g.nodes.map((node) => {
    const r = nodeRadius(node.linkCount);
    if (node.id === focusId) return { id: node.id, node, r, x: 0, y: 0, fx: 0, fy: 0 };
    const angle = hash01(node.id) * 2 * Math.PI;
    const dist = spread * Math.sqrt(hash01(`${node.id}\u0000r`));
    return { id: node.id, node, r, x: Math.cos(angle) * dist * stretch, y: (Math.sin(angle) * dist) / stretch };
  });
  const byId = new Map(nodes.map((d) => [d.id, d]));
  const edges = visualEdges(g.edges, byId);

  // One spring per connected pair, however many properties link it.
  const pairs = new Map<string, Spring>();
  for (const e of edges) pairs.set(pairKey(e.source.id, e.target.id), { source: e.source.id, target: e.target.id });

  const sim = forceSimulation<LayoutNode, Spring>(nodes)
    .randomSource(lcg())
    .force(
      "link",
      forceLink<LayoutNode, Spring>([...pairs.values()])
        .id((d) => d.id)
        .distance((l) => link + (l.source as LayoutNode).r + (l.target as LayoutNode).r),
    )
    // Whole-vault views: short-range repulsion, so separate components (a linked pair, a trio)
    // no longer push each other to the far edges and stay beside the main cluster. An ego view
    // is always one component and keeps the long range to fill its small canvas.
    .force("charge", forceManyBody<LayoutNode>().strength(charge).distanceMax(link * (focusId ? 14 : 5)))
    .force("collide", forceCollide<LayoutNode>((d) => d.r + (roomy ? 12 : 6)))
    .force("x", forceX<LayoutNode>(0).strength(0.06 / aspect ** 0.5))
    .force("y", forceY<LayoutNode>(0).strength(0.06 * aspect ** 0.75))
    .stop();
  // Exactly the ticks the default alpha schedule takes to cool below alphaMin (300).
  const ticks = Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay()));
  for (let i = 0; i < ticks; i++) sim.tick();

  const bounds: Bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const d of nodes) {
    bounds.x0 = Math.min(bounds.x0, d.x - d.r);
    bounds.y0 = Math.min(bounds.y0, d.y - d.r);
    bounds.x1 = Math.max(bounds.x1, d.x + d.r);
    bounds.y1 = Math.max(bounds.y1, d.y + d.r);
  }
  if (nodes.length === 0) Object.assign(bounds, { x0: -1, y0: -1, x1: 1, y1: 1 });
  return { nodes, byId, edges, neighbors: neighborMap(g.edges), bounds };
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

const r1 = (n: number) => Math.round(n * 10) / 10;

function toward(x: number, y: number, tx: number, ty: number, d: number): [number, number] {
  const dx = tx - x;
  const dy = ty - y;
  const len = Math.hypot(dx, dy) || 1;
  return [x + (dx / len) * d, y + (dy / len) * d];
}

/** Path for an edge, trimmed to the node rims plus `gap` so arrowheads touch the circle. "" when the nodes overlap. */
export function edgePath(e: LayoutEdge, gap: number): string {
  const { source: s, target: t } = e;
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const len = Math.hypot(dx, dy);
  if (len <= s.r + t.r + 2 * gap) return "";
  // Quadratic control point: the chord's midpoint pushed sideways by 2 × bend (the curve peaks at bend).
  const cx = (s.x + t.x) / 2 - (dy / len) * e.bend * 2;
  const cy = (s.y + t.y) / 2 + (dx / len) * e.bend * 2;
  const [x1, y1] = toward(s.x, s.y, cx, cy, s.r + gap);
  const [x2, y2] = toward(t.x, t.y, cx, cy, t.r + gap);
  return e.bend === 0 ? `M${r1(x1)},${r1(y1)}L${r1(x2)},${r1(y2)}` : `M${r1(x1)},${r1(y1)}Q${r1(cx)},${r1(cy)} ${r1(x2)},${r1(y2)}`;
}

/** A viewBox with its px-per-unit scale `k`: layout units → screen px is `(x - view.x) * view.k`. */
export interface GraphView {
  k: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Fit `b` into a `width` × `height` px box, leaving `pad` px for titles around the cloud and never
 * zooming past `maxScale` (a three-note ego graph stays small). The viewBox matches the box's
 * aspect exactly, so `k` is the true scale and labels can be sized in px.
 */
export function fitView(b: Bounds, width: number, height: number, pad: { x: number; top: number; bottom: number }, maxScale: number): GraphView {
  const bw = Math.max(b.x1 - b.x0, 1);
  const bh = Math.max(b.y1 - b.y0, 1);
  const k = Math.max(0.05, Math.min((width - 2 * pad.x) / bw, (height - pad.top - pad.bottom) / bh, maxScale));
  const w = width / k;
  const h = height / k;
  const midY = (pad.top + (height - pad.top - pad.bottom) / 2) / k;
  return { k, x: (b.x0 + b.x1) / 2 - w / 2, y: (b.y0 + b.y1) / 2 - midY, w, h };
}

export function screenPoint(view: GraphView, x: number, y: number): { x: number; y: number } {
  return { x: (x - view.x) * view.k, y: (y - view.y) * view.k };
}

// ---------------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------------

/** Rough rendered width of a title in px (Inter averages ≈0.56em per character in these slugs). */
export function labelWidth(text: string, fontPx: number): number {
  return text.length * fontPx * 0.56;
}

/**
 * Greedy, deterministic title placement in screen px: candidates in the order given (put the most
 * important first) take their spot centred `offsetPx` under their node unless the box would cover a
 * title already placed or the centre of another note (grazing a rim is fine: the halo keeps the
 * title legible). Returns the ids that get a title.
 */
export function placeLabels(
  candidates: readonly LayoutNode[],
  all: readonly LayoutNode[],
  view: GraphView,
  text: (d: LayoutNode) => string,
  { fontPx, offsetPx }: { fontPx: number; offsetPx: number },
): Set<string> {
  const placed: Bounds[] = [];
  const ids = new Set<string>();
  const centres = all.map((d) => ({ id: d.id, ...screenPoint(view, d.x, d.y) }));
  for (const d of candidates) {
    const p = screenPoint(view, d.x, d.y);
    const w = labelWidth(text(d), fontPx) + 4;
    const baseline = p.y + d.r * view.k + offsetPx;
    const box = { x0: p.x - w / 2, x1: p.x + w / 2, y0: baseline - fontPx * 0.8, y1: baseline + fontPx * 0.25 };
    const hitsLabel = placed.some((b) => box.x0 < b.x1 && b.x0 < box.x1 && box.y0 < b.y1 && b.y0 < box.y1);
    const hitsNode = centres.some((c) => c.id !== d.id && c.x > box.x0 - 2 && c.x < box.x1 + 2 && c.y > box.y0 - 2 && c.y < box.y1 + 2);
    if (hitsLabel || hitsNode) continue;
    placed.push(box);
    ids.add(d.id);
  }
  return ids;
}
