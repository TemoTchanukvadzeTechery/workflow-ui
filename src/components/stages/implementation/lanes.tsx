/**
 * Wave lanes for the plan views (STYLE.md 1): a wave is a 20px well, its tasks raised rows inside
 * it, like the reference's selected segment in a segmented-control track.
 */
import { Layers } from "lucide-react";
import type { ReactNode } from "react";
import { plural } from "@/lib/format";

/** A task row raised inside a wave lane's well (the reference's selected-segment surface). */
export const RAISED_ROW = "rounded-[14px] bg-raised shadow-(--raised-shadow) transition-shadow hover:shadow-[var(--raised-shadow),0_8px_20px_-14px_rgb(0_0_0/0.35)]";

/** A wave as a lane: a 20px well holding the wave's tasks as raised rows. */
export function WaveLane({ wave, count, aside, children }: { wave: number; count: number; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={`Wave ${wave}`} className="rounded-[20px] bg-well p-1.5">
      <div className="flex min-h-9 items-center gap-2 px-2.5 py-1">
        <Layers aria-hidden className="size-4 text-muted-foreground" />
        <h3 className="text-[13px] font-medium text-heading">Wave {wave}</h3>
        <span className="text-[13px] text-muted-foreground tabular-nums">{plural(count, "task")}</span>
        {aside ? <span className="ml-auto flex items-center gap-2">{aside}</span> : null}
      </div>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </section>
  );
}

