/**
 * The faint neural mesh behind the /memory header (plan §2): MESH_POINTS evenly spread points
 * (Mitchell's best-candidate sampling from a fixed seed) and a line from each to its two nearest
 * neighbours, as two static path strings: lines, and dots as small filled circles. Built once per
 * page load; the layer scales it with `preserveAspectRatio="xMaxYMid slice"`, so the right edge,
 * where the brain sits, always shows. Pure and React-free.
 */
import { lcg } from "@/components/memory/graph-layout";

/** About the widest hero (the 1440px page at a typical header height), so the mesh sits near 1:1 there and keeps a similar density on narrower screens. */
export const MESH_VIEWBOX = { w: 1440, h: 300 } as const;

const MESH_POINTS = 70;
const CANDIDATES = 12;
const NEIGHBOURS = 2;
const DOT_R = 1.6;
const SEED = 20261001;

export interface NeuralMeshPaths {
  lines: string;
  dots: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function build(): NeuralMeshPaths {
  const rand = lcg(SEED);
  const { w, h } = MESH_VIEWBOX;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < MESH_POINTS; i++) {
    let best: [number, number] = [rand() * w, rand() * h];
    let bestGap = -1;
    for (let c = 0; c < (i === 0 ? 1 : CANDIDATES); c++) {
      const cand: [number, number] = c === 0 ? best : [rand() * w, rand() * h];
      let gap = Infinity;
      for (const p of pts) gap = Math.min(gap, (p[0] - cand[0]) ** 2 + (p[1] - cand[1]) ** 2);
      if (gap > bestGap) {
        bestGap = gap;
        best = cand;
      }
    }
    pts.push([r1(best[0]), r1(best[1])]);
  }

  const seen = new Set<string>();
  const lines: string[] = [];
  pts.forEach((p, i) => {
    const nearest = pts
      .map((q, j) => ({ j, d: (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 }))
      .filter((n) => n.j !== i)
      .sort((a, b) => a.d - b.d || a.j - b.j)
      .slice(0, NEIGHBOURS);
    for (const { j } of nearest) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`M${p[0]},${p[1]}L${pts[j][0]},${pts[j][1]}`);
    }
  });
  const dots = pts.map(([x, y]) => `M${r1(x - DOT_R)},${y}a${DOT_R},${DOT_R} 0 1,0 ${2 * DOT_R},0a${DOT_R},${DOT_R} 0 1,0 ${-2 * DOT_R},0`);
  return { lines: lines.join(""), dots: dots.join("") };
}

let cached: NeuralMeshPaths | null = null;

export function neuralMeshPaths(): NeuralMeshPaths {
  return (cached ??= build());
}
