/**
 * Where the data brain's neurons go (plan §2): every note is a neuron inside one of the brain's
 * two lobes (brain-shape.ts), every connected pair one synapse. Start points are rejection-sampled
 * inside the lobes from a generator seeded by the note id's FNV hash, so a note keeps its place
 * across renders and vault edits; `org/plexus` is pinned at the centroid. Then exactly TICKS
 * synchronous d3-force ticks (collision, a weak pull between connected notes, a short-range
 * spread, and a force that holds every neuron inside its lobe), and a short clean-up pass that
 * guarantees containment and no overlaps. Deterministic, React-free and cheap (a few ms for the
 * real vault, under 20 ms for 300 notes once warm), so it runs once in a useMemo and during
 * server rendering.
 */
import { forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { hash01, lcg } from "@/components/memory/graph-layout";
import type { MemoryGraphNode, MemoryGraphPayload } from "@/lib/memory/types";
import { BBOX, BRAIN_AREA, BRAIN_VIEWBOX, CENTROID, brainProbe } from "./brain-shape";

/** Pinned at the centroid: the organisation every system hangs off. */
export const BRAIN_CORE_ID = "org/plexus";

const TICKS = 80;
/**
 * A low start keeps the link pull weak (only the link force scales with alpha): over TICKS ticks a
 * linked pair closes roughly a third of its gap to LINK_DISTANCE, so the neurons still fill the
 * outline and connected notes only lean together.
 */
const START_ALPHA = 0.2;
/** Start points keep this much room (plus the radius) from the outline. */
const SEED_MARGIN = 6;
/** Settled neurons keep this much room (plus the radius) from the outline. */
const CONTAIN_MARGIN = 3.5;
const COLLIDE_PAD = 2.2;
const LINK_DISTANCE = 40;
const LINK_STRENGTH = 0.02;
/** Short-range repulsion that spreads the cloud through the whole brain instead of its middle. */
const SPREAD_STRENGTH = -18;
const SPREAD_RANGE = 90;
const MAX_HUBS = 5;
const HUB_MIN_LINKS = 3;
const MAX_PULSES = 5;
/** How far a synapse's midpoint bows toward the centroid, as a share of the way there. */
const BOW = 0.22;
/** The neurons (plus their collision padding) may cover at most this share of the outline. */
const MAX_COVER = 0.32;

export interface Neuron {
  id: string;
  node: MemoryGraphNode;
  x: number;
  y: number;
  r: number;
  /** One of the MAX_HUBS best-linked notes (at least HUB_MIN_LINKS links). */
  hub: boolean;
  /** No links at all. */
  dormant: boolean;
}

export interface Synapse {
  key: string;
  a: string;
  b: string;
  /** A quadratic curve from a to b, bowed toward the centroid. */
  d: string;
}

/** A signal travelling one synapse from its lower-degree end to its higher-degree end. */
export interface Pulse {
  key: string;
  from: string;
  to: string;
  /** The synapse drawn from `from` to `to`. */
  d: string;
  /** Where the fire ring goes: the target neuron. */
  x: number;
  y: number;
  r: number;
}

export interface NeuronLayout {
  /** Sorted by id. */
  neurons: Neuron[];
  byId: Map<string, Neuron>;
  synapses: Synapse[];
  /** Every synapse in one path string. */
  synapsePath: string;
  /** Per neuron, its own synapses in one path string (the hover highlight). */
  synapsesOf: Map<string, string>;
  neighbors: Map<string, Set<string>>;
  pulses: Pulse[];
}

/** Radius grows with the square root of the link count (area reads as degree), 3.2..8.6 at full scale. */
export function neuronRadius(linkCount: number, scale = 1): number {
  return Math.min(8.6, 3.2 + 1.55 * Math.sqrt(Math.max(0, linkCount))) * scale;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  r: number;
  x: number;
  y: number;
}

type Spring = SimulationLinkDatum<SimNode>;

const r1 = (n: number) => Math.round(n * 10) / 10;
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const byIdOrder = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

interface Probe {
  /** Signed distance to the outline: positive inside. */
  clearance: number;
  /** The closest outline point. */
  nx: number;
  ny: number;
}

function probe(x: number, y: number): Probe {
  return brainProbe(x, y);
}

/** The point `need` units inside the outline, straight in from the outline point closest to (x, y). */
function inward(x: number, y: number, p: Probe, need: number): { x: number; y: number } {
  const dist = Math.abs(p.clearance);
  let ux: number;
  let uy: number;
  if (dist > 1e-6) {
    // Away from the outline when inside, toward it when outside.
    const s = p.clearance > 0 ? 1 : -1;
    ux = (s * (x - p.nx)) / dist;
    uy = (s * (y - p.ny)) / dist;
  } else {
    const dx = CENTROID.x - x;
    const dy = CENTROID.y - y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    ux = dx / len;
    uy = dy / len;
  }
  return { x: p.nx + ux * need, y: p.ny + uy * need };
}

/** Where (x, y) should be to keep `need` units inside the outline, or null when it already is. */
function containTarget(x: number, y: number, need: number): { x: number; y: number } | null {
  const p = probe(x, y);
  return p.clearance >= need ? null : inward(x, y, p, need);
}

/**
 * A start point inside the brain with `margin` to spare, from the id's own generator. Sampling the
 * whole box keeps the share of neurons per lobe proportional to its area.
 */
function seedPoint(id: string, margin: number): { x: number; y: number } {
  const rand = lcg(Math.floor(hash01(id) * 4294967296) || 1);
  const w = BBOX.x1 - BBOX.x0;
  const h = BBOX.y1 - BBOX.y0;
  for (let attempt = 0; attempt < 64; attempt++) {
    const x = BBOX.x0 + rand() * w;
    const y = BBOX.y0 + rand() * h;
    if (!containTarget(x, y, margin)) return { x, y };
  }
  // Practically unreachable (the lobes fill most of their box); a nudge keeps ids apart.
  return { x: CENTROID.x + (hash01(`${id}\u0000x`) - 0.5) * 40, y: CENTROID.y + (hash01(`${id}\u0000y`) - 0.5) * 30 };
}

/**
 * d3 custom force: steer each neuron's next position back inside the outline. Measuring the
 * outline is the costly part (a pass over the polyline), so each neuron remembers where it was
 * last measured and the clearance there: clearance changes by at most the distance moved, so a
 * neuron well inside is only measured again once it has strayed far enough to matter.
 */
function forceContain(strength: number) {
  let nodes: SimNode[] = [];
  // Per neuron: x, y and signed clearance at the last measurement (-Infinity: never measured).
  let seen = new Float64Array(0);
  const force = () => {
    for (let i = 0; i < nodes.length; i++) {
      const d = nodes[i];
      if (d.fx != null) continue;
      const px = d.x + (d.vx ?? 0);
      const py = d.y + (d.vy ?? 0);
      const need = d.r + CONTAIN_MARGIN;
      const k = 3 * i;
      const dx = px - seen[k];
      const dy = py - seen[k + 1];
      if (seen[k + 2] - Math.sqrt(dx * dx + dy * dy) >= need) continue;
      const p = probe(px, py);
      seen[k] = px;
      seen[k + 1] = py;
      seen[k + 2] = p.clearance;
      if (p.clearance >= need) continue;
      const t = inward(px, py, p, need);
      d.vx = (d.vx ?? 0) + (t.x - px) * strength;
      d.vy = (d.vy ?? 0) + (t.y - py) * strength;
    }
  };
  force.initialize = (n: SimNode[]) => {
    nodes = n;
    seen = new Float64Array(3 * n.length);
    for (let i = 0; i < n.length; i++) seen[3 * i + 2] = -Infinity;
  };
  return force;
}

/**
 * d3 custom force: d3's forceCollide arithmetic (strength 1, one pass, on the predicted positions,
 * the push shared by radius²), with neighbours found through a uniform grid instead of a quadtree.
 * The quadtree walk alone took ~45 ms for 300 notes over TICKS ticks; the grid takes a few.
 */
function forceSeparate(pad: number) {
  let nodes: SimNode[] = [];
  const force = () => {
    const n = nodes.length;
    let maxR = 0;
    for (const d of nodes) maxR = Math.max(maxR, d.r + pad);
    // Cells as wide as the largest pair distance: every touching pair is in neighbouring cells.
    // Points outside the viewBox clamp to the edge cells, which keeps neighbours neighbours.
    const cell = 2 * maxR || 1;
    const cols = Math.ceil(BRAIN_VIEWBOX.w / cell) + 1;
    const rows = Math.ceil(BRAIN_VIEWBOX.h / cell) + 1;
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    const col = new Int32Array(n);
    const row = new Int32Array(n);
    const start = new Int32Array(cols * rows + 1);
    for (let i = 0; i < n; i++) {
      const d = nodes[i];
      px[i] = d.x + (d.vx ?? 0);
      py[i] = d.y + (d.vy ?? 0);
      col[i] = Math.min(cols - 1, Math.max(0, Math.floor(px[i] / cell)));
      row[i] = Math.min(rows - 1, Math.max(0, Math.floor(py[i] / cell)));
      start[row[i] * cols + col[i] + 1]++;
    }
    for (let c = 0; c < cols * rows; c++) start[c + 1] += start[c];
    const fill = start.slice(0, cols * rows);
    const items = new Int32Array(n);
    for (let i = 0; i < n; i++) items[fill[row[i] * cols + col[i]]++] = i;

    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      const ri = a.r + pad;
      const ri2 = ri * ri;
      // a's predicted position, fixed for its pass (as in forceCollide); its partners' are live.
      const xi = px[i];
      const yi = py[i];
      for (let gy = Math.max(0, row[i] - 1); gy <= Math.min(rows - 1, row[i] + 1); gy++) {
        for (let gx = Math.max(0, col[i] - 1); gx <= Math.min(cols - 1, col[i] + 1); gx++) {
          const c = gy * cols + gx;
          for (let k = start[c]; k < start[c + 1]; k++) {
            const j = items[k];
            if (j <= i) continue;
            const b = nodes[j];
            const rj = b.r + pad;
            const r = ri + rj;
            let x = xi - b.x - (b.vx ?? 0);
            let y = yi - b.y - (b.vy ?? 0);
            let l = x * x + y * y;
            if (l >= r * r) continue;
            // Coincident centres: a fixed nudge instead of d3's random jiggle keeps this deterministic.
            if (x === 0) {
              x = (j - i) * 1e-6;
              l += x * x;
            }
            if (y === 0) {
              y = (j - i) * 1e-6;
              l += y * y;
            }
            l = Math.sqrt(l);
            l = (r - l) / l;
            x *= l;
            y *= l;
            const share = (rj * rj) / (ri2 + rj * rj);
            a.vx = (a.vx ?? 0) + x * share;
            a.vy = (a.vy ?? 0) + y * share;
            b.vx = (b.vx ?? 0) - x * (1 - share);
            b.vy = (b.vy ?? 0) - y * (1 - share);
          }
        }
      }
    }
  };
  force.initialize = (n: SimNode[]) => {
    nodes = n;
  };
  return force;
}

/**
 * The guarantee after the simulation: every neuron inside the outline with its radius to spare and
 * no two neurons overlapping. Pairwise pushes alternate with containment until both hold (a few
 * passes at most; O(n²) per pass, fine for a few hundred notes).
 */
function settle(nodes: SimNode[]): void {
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const min = a.r + b.r + 1;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;
        if (distSq >= min * min) continue;
        moved = true;
        const dist = Math.sqrt(distSq);
        const ux = dist > 1e-6 ? dx / dist : 1;
        const uy = dist > 1e-6 ? dy / dist : 0;
        const push = min - dist;
        // A pinned neuron does not move; the other takes the whole push.
        const shareA = a.fx != null ? 0 : b.fx != null ? 1 : 0.5;
        a.x -= ux * push * shareA;
        a.y -= uy * push * shareA;
        b.x += ux * push * (1 - shareA);
        b.y += uy * push * (1 - shareA);
      }
    }
    for (const d of nodes) {
      if (d.fx != null || !containTarget(d.x, d.y, d.r + 1)) continue;
      moved = true;
      // Land the full margin deep, so the next pairwise push rarely undoes it.
      const t = containTarget(d.x, d.y, d.r + CONTAIN_MARGIN)!;
      d.x = t.x;
      d.y = t.y;
    }
    if (!moved) return;
  }
}

/** Quadratic from (ax, ay) to (bx, by) whose control point pulls the midpoint toward the centroid. */
function synapseCurve(ax: number, ay: number, bx: number, by: number): string {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const cx = mx + (CENTROID.x - mx) * BOW;
  const cy = my + (CENTROID.y - my) * BOW;
  return `M${r1(ax)},${r1(ay)}Q${r1(cx)},${r1(cy)} ${r1(bx)},${r1(by)}`;
}

/**
 * Up to MAX_PULSES synapses that share no neuron, each flowing from its lower-degree end to its
 * higher-degree end. Busiest targets first (signals converge on the hubs), longer synapses before
 * shorter ones (a pulse needs room to read), then the pair key, so the pick is stable.
 */
function pickPulses(synapses: readonly Synapse[], byId: ReadonlyMap<string, Neuron>): Pulse[] {
  const deg = (id: string) => byId.get(id)?.node.linkCount ?? 0;
  const candidates = synapses.map((s) => {
    const [from, to] = deg(s.a) < deg(s.b) || (deg(s.a) === deg(s.b) && s.a > s.b) ? [s.a, s.b] : [s.b, s.a];
    const f = byId.get(from)!;
    const t = byId.get(to)!;
    return { key: s.key, from: f, to: t, length: Math.hypot(t.x - f.x, t.y - f.y) };
  });
  candidates.sort((p, q) => deg(q.to.id) - deg(p.to.id) || q.length - p.length || (p.key < q.key ? -1 : 1));
  const used = new Set<string>();
  const pulses: Pulse[] = [];
  for (const c of candidates) {
    if (pulses.length >= MAX_PULSES) break;
    if (used.has(c.from.id) || used.has(c.to.id) || c.length < c.from.r + c.to.r + 12) continue;
    used.add(c.from.id);
    used.add(c.to.id);
    pulses.push({ key: c.key, from: c.from.id, to: c.to.id, d: synapseCurve(c.from.x, c.from.y, c.to.x, c.to.y), x: c.to.x, y: c.to.y, r: c.to.r });
  }
  return pulses;
}

export function placeNeurons(graph: MemoryGraphPayload): NeuronLayout {
  const notes = [...graph.nodes].sort(byIdOrder);
  const ids = new Set(notes.map((n) => n.id));

  // A crowded vault shrinks every neuron alike, so the outline never fills past MAX_COVER.
  const cover = notes.reduce((s, n) => s + Math.PI * (neuronRadius(n.linkCount) + COLLIDE_PAD) ** 2, 0);
  const scale = cover > 0 ? Math.min(1, Math.sqrt((MAX_COVER * BRAIN_AREA) / cover)) : 1;

  const hubIds = new Set(
    notes
      .filter((n) => n.linkCount >= HUB_MIN_LINKS)
      .sort((a, b) => b.linkCount - a.linkCount || byIdOrder(a, b))
      .slice(0, MAX_HUBS)
      .map((n) => n.id),
  );

  const sim: SimNode[] = notes.map((n) => {
    const r = neuronRadius(n.linkCount, scale);
    if (n.id === BRAIN_CORE_ID) return { id: n.id, r, x: CENTROID.x, y: CENTROID.y, fx: CENTROID.x, fy: CENTROID.y };
    return { id: n.id, r, ...seedPoint(n.id, r + SEED_MARGIN) };
  });

  // One undirected spring per connected pair, however many properties link it.
  const pairs = new Map<string, { a: string; b: string }>();
  for (const e of graph.edges) {
    if (e.from === e.to || !ids.has(e.from) || !ids.has(e.to)) continue;
    const key = pairKey(e.from, e.to);
    if (!pairs.has(key)) pairs.set(key, e.from < e.to ? { a: e.from, b: e.to } : { a: e.to, b: e.from });
  }
  const keys = [...pairs.keys()].sort();

  if (sim.length > 0) {
    const springs: Spring[] = keys.map((k) => ({ source: pairs.get(k)!.a, target: pairs.get(k)!.b }));
    const simulation = forceSimulation<SimNode, Spring>(sim)
      .randomSource(lcg())
      .alpha(START_ALPHA)
      .force("link", forceLink<SimNode, Spring>(springs).id((d) => d.id).distance(LINK_DISTANCE).strength(LINK_STRENGTH))
      .force("spread", forceManyBody<SimNode>().strength(SPREAD_STRENGTH).distanceMax(SPREAD_RANGE))
      .force("collide", forceSeparate(COLLIDE_PAD))
      .force("contain", forceContain(0.6))
      .stop();
    for (let i = 0; i < TICKS; i++) simulation.tick();
    settle(sim);
  }

  const neurons: Neuron[] = sim.map((d, i) => {
    const node = notes[i];
    return { id: d.id, node, x: r1(d.x), y: r1(d.y), r: r1(d.r), hub: hubIds.has(d.id), dormant: node.linkCount === 0 };
  });
  const byId = new Map(neurons.map((n) => [n.id, n]));

  const synapses: Synapse[] = keys.map((key) => {
    const { a, b } = pairs.get(key)!;
    const na = byId.get(a)!;
    const nb = byId.get(b)!;
    return { key, a, b, d: synapseCurve(na.x, na.y, nb.x, nb.y) };
  });
  const own = new Map<string, string[]>();
  const neighbors = new Map<string, Set<string>>();
  const link = (id: string, other: string, d: string) => {
    const ds = own.get(id) ?? [];
    ds.push(d);
    own.set(id, ds);
    neighbors.set(id, (neighbors.get(id) ?? new Set<string>()).add(other));
  };
  for (const s of synapses) {
    link(s.a, s.b, s.d);
    link(s.b, s.a, s.d);
  }

  return {
    neurons,
    byId,
    synapses,
    synapsePath: synapses.map((s) => s.d).join(""),
    synapsesOf: new Map([...own].map(([id, ds]) => [id, ds.join("")])),
    neighbors,
    pulses: pickPulses(synapses, byId),
  };
}
