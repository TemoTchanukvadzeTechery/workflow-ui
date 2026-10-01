/**
 * The abstract brain behind the /memory header's data brain (plan §2): a side view as seen from
 * the left ear, in a 400×280 viewBox with the front to the left. Two soft lobes (the cerebrum's
 * dome and the small cerebellum tucked under its back) and one faint fold along the side; no stem
 * and no other folds, so it reads as a brain without being anatomy. Each lobe is a uniform
 * Catmull-Rom spline through hand-placed anchors, turned into cubic Béziers for drawing and
 * sampled from those same Béziers into a polyline for the geometry tests, so a neuron that passes
 * `brainProbe` sits inside a drawn outline. Pure and React-free, so it runs during server
 * rendering and in plain node tests.
 */

export type Pt = readonly [number, number];

export const BRAIN_VIEWBOX = { w: 400, h: 280 } as const;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Clockwise from the front: the crown, the back, the underside over the cerebellum, the temporal lobe. */
const CEREBRUM_ANCHORS: readonly Pt[] = [
  [34, 150], [44, 104], [74, 64], [120, 36], [176, 22], [236, 22], [290, 36], [334, 64], [362, 104], [370, 148],
  [356, 182], [326, 198], [292, 202], [256, 206], [226, 222], [190, 232], [150, 228], [122, 212], [112, 192],
  [86, 196], [58, 186], [40, 170],
];

/** Tucked under the back of the cerebrum, which is drawn over the seam. */
const CEREBELLUM_ANCHORS: readonly Pt[] = [
  [282, 180], [326, 170], [362, 182], [374, 208], [356, 232], [316, 240], [284, 230], [272, 204],
];

/** The one fold kept: from the notch above the temporal lobe back along the side. */
const FOLD_ANCHORS: readonly Pt[] = [
  [112, 192], [160, 176], [214, 170], [262, 160],
];

// ---------------------------------------------------------------------------------------------
// Catmull-Rom
// ---------------------------------------------------------------------------------------------

export interface Spline {
  /** SVG path data: cubic Béziers through every anchor (closed with Z when the curve is). */
  d: string;
  /** The same Béziers sampled into a polyline (no repeated closing point). */
  points: Pt[];
  /** `points` as flat coordinate arrays, for the geometry tests' hot loops. */
  xs: Float64Array;
  ys: Float64Array;
}

/** A polyline as flat coordinate arrays (a Spline is one). */
export interface Polygon {
  xs: Float64Array;
  ys: Float64Array;
}


function bezierAt(p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const e = t * t * t;
  return [a * p0[0] + b * c1[0] + c * c2[0] + e * p1[0], a * p0[1] + b * c1[1] + c * c2[1] + e * p1[1]];
}

/**
 * Uniform Catmull-Rom through `anchors`, as Béziers (control points p1 + (p2 - p0) / 6 and
 * p2 - (p3 - p1) / 6) and as a polyline of `samples` points per segment. An open curve repeats its
 * end anchors as the missing neighbours.
 */
export function catmullRom(anchors: readonly Pt[], { closed, samples = 8 }: { closed: boolean; samples?: number }): Spline {
  const n = anchors.length;
  if (n < 2) return flat("", [...anchors]);
  const at = (i: number): Pt => (closed ? anchors[(i + n) % n] : anchors[Math.min(n - 1, Math.max(0, i))]);
  const segments = closed ? n : n - 1;
  const d: string[] = [`M${r1(anchors[0][0])},${r1(anchors[0][1])}`];
  const points: Pt[] = [];
  for (let i = 0; i < segments; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d.push(`C${r1(c1[0])},${r1(c1[1])} ${r1(c2[0])},${r1(c2[1])} ${r1(p2[0])},${r1(p2[1])}`);
    for (let k = 0; k < samples; k++) points.push(bezierAt(p1, c1, c2, p2, k / samples));
  }
  if (closed) d.push("Z");
  else points.push(anchors[n - 1]);
  return flat(d.join(""), points);
}

function flat(d: string, points: Pt[]): Spline {
  return { d, points, xs: Float64Array.from(points, (p) => p[0]), ys: Float64Array.from(points, (p) => p[1]) };
}

// ---------------------------------------------------------------------------------------------
// The shapes
// ---------------------------------------------------------------------------------------------

export const CEREBRUM = catmullRom(CEREBRUM_ANCHORS, { closed: true });
export const CEREBELLUM = catmullRom(CEREBELLUM_ANCHORS, { closed: true });
export const FOLD = catmullRom(FOLD_ANCHORS, { closed: false });

/** The lobes neurons live in, in drawing order (back to front: the cerebrum covers the seam). */
export const LOBES = [CEREBELLUM, CEREBRUM] as const;

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

/** Even-odd ray cast. */
export function pointInPolygon(x: number, y: number, { xs, ys }: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    const yi = ys[i];
    const yj = ys[j];
    if (yi > y !== yj > y && x < ((xs[j] - xs[i]) * (y - yi)) / (yj - yi) + xs[i]) inside = !inside;
  }
  return inside;
}

/** The closest point on the polygon's outline and the distance to it. */
export function nearestOnPolygon(x: number, y: number, { xs, ys }: Polygon): { x: number; y: number; dist: number } {
  let bx = xs[0];
  let by = ys[0];
  let bestSq = Infinity;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    const ax = xs[j];
    const ay = ys[j];
    const dx = xs[i] - ax;
    const dy = ys[i] - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / lenSq));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const dSq = (x - px) * (x - px) + (y - py) * (y - py);
    if (dSq < bestSq) {
      bestSq = dSq;
      bx = px;
      by = py;
    }
  }
  return { x: bx, y: by, dist: Math.sqrt(bestSq) };
}

/** Area centroid (shoelace) and area of a simple polygon. */
function centroidOf(poly: readonly Pt[]): { x: number; y: number; area: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const cross = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += cross;
    cx += (poly[j][0] + poly[i][0]) * cross;
    cy += (poly[j][1] + poly[i][1]) * cross;
  }
  a /= 2;
  return { x: cx / (6 * a), y: cy / (6 * a), area: Math.abs(a) };
}

const parts = LOBES.map((h) => centroidOf(h.points));
const area = parts.reduce((sum, p) => sum + p.area, 0);

/** The brain's area centroid, inside the cerebrum: the synapses bow toward it and `org/plexus` is pinned there. */
export const CENTROID = {
  x: r1(parts.reduce((sum, p) => sum + p.x * p.area, 0) / area),
  y: r1(parts.reduce((sum, p) => sum + p.y * p.area, 0) / area),
} as const;

/** Both lobes' area in viewBox units², for sizing neurons to the room they have. */
export const BRAIN_AREA = area;

/** The bounding box of both lobes, for sampling start points. */
export const BBOX = LOBES.flatMap((lobe) => lobe.points).reduce(
  (b, [x, y]) => ({ x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) }),
  { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
);

/**
 * Signed distance from (x, y) to the brain, positive inside a lobe, with the closest outline
 * point: the lobe it is in (the one it is deepest in where they overlap), or else the nearer one.
 */
export function brainProbe(x: number, y: number): { clearance: number; nx: number; ny: number } {
  let best = { clearance: -Infinity, nx: x, ny: y };
  for (const lobe of LOBES) {
    const near = nearestOnPolygon(x, y, lobe);
    const clearance = pointInPolygon(x, y, lobe) ? near.dist : -near.dist;
    if (clearance > best.clearance) best = { clearance, nx: near.x, ny: near.y };
  }
  return best;
}
