"use client";

/**
 * The /memory header (plan §2): the page title, description and toolbar (tabs + refresh, under
 * the description as on stage pages) on the left, the living data brain on the right, and a faint
 * neural mesh behind both. The mesh is masked to a soft ellipse around the brain, so the title
 * area stays clean, and bleeds into main's padding exactly (no further, so no horizontal scroll).
 * Below md the brain and the mesh are hidden and the header is the plain PageHeader.
 */
import type { ReactNode } from "react";
import { PageHeader } from "@/components/common";
import type { MemoryGraphPayload } from "@/lib/memory/types";
import { MemoryBrain } from "./memory-brain";
import { MESH_VIEWBOX, neuralMeshPaths } from "./neural-mesh";

export interface MemoryHeroProps {
  description: ReactNode;
  /** The tabs and the refresh button; omitted when the vault is missing. */
  toolbar?: ReactNode;
  /** The graph the brain's neurons and synapses come from; undefined while loading or unavailable. */
  graph?: MemoryGraphPayload;
}

/** Full strength around the brain, half by 40%, gone by 75%: the title side shows none of it. */
const MESH_MASK = "radial-gradient(55% 80% at 80% 45%, #000, rgb(0 0 0 / .55) 40%, transparent 75%)";
/** A breath of blue behind the brain, so the tissue reads as lit from within. */
const MESH_GLOW = "radial-gradient(26% 62% at 86% 48%, color-mix(in oklab, var(--chart-1) 7%, transparent), transparent 72%)";

/**
 * Absolutely positioned at -z-10 inside the hero's isolated stacking context. Its insets match the
 * page container's side padding (px-5, lg:px-8) and main's top padding (pt-3, lg:pt-4), and it
 * reaches into the gap under the hero (gap-6, lg:gap-7).
 */
function NeuralMeshBackdrop() {
  const { lines, dots } = neuralMeshPaths();
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -inset-x-5 -top-3 -bottom-6 -z-10 hidden overflow-hidden md:block lg:-inset-x-8 lg:-top-4 lg:-bottom-7"
      style={{ maskImage: MESH_MASK, WebkitMaskImage: MESH_MASK, backgroundImage: MESH_GLOW }}
    >
      <svg viewBox={`0 0 ${MESH_VIEWBOX.w} ${MESH_VIEWBOX.h}`} preserveAspectRatio="xMaxYMid slice" width="100%" height="100%" focusable="false" className="block">
        <path d={lines} fill="none" strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ stroke: "var(--muted-foreground)", opacity: 0.18 }} />
        <path d={dots} style={{ fill: "color-mix(in oklab, var(--chart-1) 45%, var(--muted-foreground))", opacity: 0.36 }} />
      </svg>
    </div>
  );
}

export function MemoryHero({ description, toolbar, graph }: MemoryHeroProps) {
  return (
    <div className="relative isolate grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-8 lg:gap-12">
      <NeuralMeshBackdrop />
      <PageHeader title="Memory" description={description} className="min-w-0">
        {toolbar}
      </PageHeader>
      <MemoryBrain graph={graph} className="hidden md:block" />
    </div>
  );
}
