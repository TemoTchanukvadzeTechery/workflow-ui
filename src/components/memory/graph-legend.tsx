/**
 * MemoryGraph's node drawing and key (plan A5): NodeMark draws one note (type fill, status
 * decorations, badges); GraphLegend lists note types (swatch + type icon + label), then edge
 * styles and status marks, each only when the graph on screen uses it. Glyphs are drawn at the
 * origin in px scaled by `u` (viewBox units per px), so one shape serves a node badge and a legend
 * swatch. Hook-free.
 */
import { MEMORY_NOTE_TYPES } from "@/lib/memory/types";
import { cn } from "@/lib/utils";
import { EDGE_LABEL, EDGE_LOOK, EDGE_STYLES, NODE_MARKS, hasMark, type EdgeStyle, type GraphLayout, type LayoutNode, type NodeMark as NodeMarkKind } from "./graph-layout";
import { MEMORY_TYPE_COLOR } from "./stats-header";
import { MemoryTypeLabel } from "./status-meta";

/** Amber is the same in both themes, so the glyph ink can be fixed (#1C1C1E, --ink in light). */
const GLYPH_INK = "#1c1c1e";

/** Seed blocked: an amber disc with "!". */
export function SeedBlockedGlyph({ u = 1 }: { u?: number }) {
  return (
    <g>
      <circle r={5.25 * u} style={{ fill: "var(--status-attention-solid)", stroke: "var(--card)" }} strokeWidth={1.25 * u} />
      <text textAnchor="middle" dy="0.36em" fontSize={8 * u} fontWeight={700} style={{ fill: GLYPH_INK }}>
        !
      </text>
    </g>
  );
}

/** Drifted document: an amber warning triangle with "!". */
export function DriftGlyph({ u = 1 }: { u?: number }) {
  return (
    <g>
      <path
        d={`M0,${-6 * u}L${6.4 * u},${5 * u}L${-6.4 * u},${5 * u}Z`}
        strokeLinejoin="round"
        style={{ fill: "var(--status-attention-solid)", stroke: "var(--card)" }}
        strokeWidth={1.25 * u}
      />
      <text textAnchor="middle" y={3.6 * u} fontSize={7 * u} fontWeight={700} style={{ fill: GLYPH_INK }}>
        !
      </text>
    </g>
  );
}

/** One note at the origin: focus ring, proposed dashed ring, fill (hollow when deprecated/retired), badges. */
export function NodeMark({ d, u, focus }: { d: LayoutNode; u: number; focus: boolean }) {
  const { node, r } = d;
  const color = MEMORY_TYPE_COLOR[node.type];
  const hollow = hasMark(node, "retired");
  const badge = r * 0.72 + 1.5 * u;
  return (
    <>
      {focus && <circle r={r + 4.5 * u} fill="none" strokeWidth={1.75 * u} style={{ stroke: "var(--heading)" }} />}
      {hasMark(node, "proposed") && (
        <circle r={r + 3 * u} fill="none" strokeWidth={1.3 * u} strokeDasharray={`${2.6 * u} ${2 * u}`} style={{ stroke: "var(--status-review-solid)" }} />
      )}
      <circle r={r} strokeWidth={(hollow ? 2 : 1.5) * u} style={hollow ? { fill: "var(--card)", stroke: color } : { fill: color, stroke: "var(--card)" }} />
      {node.flags.seedBlocked && (
        <g transform={`translate(${badge},${-badge})`}>
          <SeedBlockedGlyph u={u} />
        </g>
      )}
      {node.flags.isStaleDoc && (
        <g transform={`translate(${-badge},${-badge})`}>
          <DriftGlyph u={u} />
        </g>
      )}
    </>
  );
}

function EdgeSwatch({ style }: { style: EdgeStyle }) {
  const look = EDGE_LOOK[style];
  const color = { stroke: "var(--muted-foreground)" };
  return (
    <svg aria-hidden width={28} height={10} viewBox="0 0 28 10" className="shrink-0">
      <line
        x1={1}
        y1={5}
        x2={style === "dependency" ? 21 : 27}
        y2={5}
        strokeWidth={look.width}
        strokeDasharray={look.dash?.join(" ")}
        strokeLinecap={look.round ? "round" : "butt"}
        opacity={Math.max(look.opacity, 0.55)}
        style={color}
      />
      {style === "dependency" && <path d="M20,1.5L27,5L20,8.5Z" style={{ fill: "var(--muted-foreground)" }} />}
    </svg>
  );
}

function MarkSwatch({ mark }: { mark: NodeMarkKind }) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="-8 -8 16 16" className="shrink-0 overflow-visible">
      {mark === "proposed" && (
        <>
          <circle r={3.5} style={{ fill: "var(--status-neutral-solid)" }} />
          <circle r={6.5} fill="none" strokeWidth={1.3} strokeDasharray="2.6 2" style={{ stroke: "var(--status-review-solid)" }} />
        </>
      )}
      {mark === "retired" && <circle r={5} strokeWidth={2} style={{ fill: "var(--card)", stroke: "var(--status-neutral-solid)" }} />}
      {mark === "seedBlocked" && <SeedBlockedGlyph />}
      {mark === "drifted" && <DriftGlyph />}
    </svg>
  );
}

export function GraphLegend({ layout, className }: { layout: GraphLayout; className?: string }) {
  const types = MEMORY_NOTE_TYPES.filter((t) => layout.nodes.some((d) => d.node.type === t));
  const styles = EDGE_STYLES.filter((s) => layout.edges.some((e) => e.style === s));
  const marks = NODE_MARKS.filter((m) => layout.nodes.some((d) => m.test(d.node)));
  const item = "inline-flex items-center gap-2 whitespace-nowrap";
  return (
    <div className={cn("flex flex-col gap-2 text-[13px] leading-5 text-muted-foreground", className)}>
      <ul aria-label="Note types" className="flex flex-wrap gap-x-4 gap-y-1.5">
        {types.map((t) => (
          <li key={t} className={item}>
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: MEMORY_TYPE_COLOR[t] }} />
            <MemoryTypeLabel type={t} />
          </li>
        ))}
      </ul>
      {styles.length + marks.length > 0 && (
        <ul aria-label="Connections and status marks" className="flex flex-wrap gap-x-4 gap-y-1.5">
          {styles.map((s) => (
            <li key={s} className={item} title={EDGE_LABEL[s].hint}>
              <EdgeSwatch style={s} />
              {EDGE_LABEL[s].label}
            </li>
          ))}
          {marks.map((m) => (
            <li key={m.mark} className={item}>
              <MarkSwatch mark={m.mark} />
              {m.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
