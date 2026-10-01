import Link from "next/link";
import { useId } from "react";
import { cn } from "@/lib/utils";

/*
 * The woven W (28×28 viewBox). Two V-shaped threads overlap into a W, and where their middle
 * strokes cross, the peach thread passes under the cream one, like a weft through the warp.
 * src/app/icon.svg (and the favicon.ico and apple-icon.png rendered from it) draw the same
 * geometry; keep them in sync.
 */
const OVER = "M5.45 8.5 11.15 19.5 16.85 8.5";
const UNDER = "M11.15 8.5 16.85 19.5 22.55 8.5";
/** A band along the cream stroke at the crossing, cut out of the peach thread (butt ends). */
const CROSSING = "M12.16 17.55 15.84 10.45";
const THREAD = 2.6;
const GAP = 0.8;

/** The orange rounded-square mark (STYLE.md 4): a woven cream-and-peach W. */
export function BrandMark({ className }: { className?: string }) {
  const maskId = useId();
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-[linear-gradient(135deg,#FFB547,#F26A1B)]",
        "shadow-[inset_0_1px_0_rgba(255,255,255,.45),inset_0_-1px_0_rgba(160,60,0,.25),0_4px_10px_-3px_rgba(242,106,27,.55)]",
        className,
      )}
    >
      <svg viewBox="0 0 28 28" className="size-full" fill="none" strokeWidth={THREAD} strokeLinecap="round" strokeLinejoin="round">
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="28" height="28">
          <rect width="28" height="28" fill="#fff" />
          <path d={CROSSING} stroke="#000" strokeWidth={THREAD + 2 * GAP} strokeLinecap="butt" />
        </mask>
        <path d={UNDER} stroke="#FFD9A0" mask={`url(#${maskId})`} />
        <path d={OVER} stroke="#FFF6E4" />
      </svg>
    </span>
  );
}

/** Mark and "Wefty" wordmark, linking home. The "on weft · mock" note shows on wide screens. */
export function Brand({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      aria-label="Wefty home"
      className={cn("group/brand inline-flex min-w-0 items-center gap-2.5 rounded-[14px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}
    >
      <BrandMark />
      <span className="truncate text-[20px] leading-none font-medium tracking-[-0.035em] text-heading sm:text-[26px]">Wefty</span>
      <span className="mt-1.5 hidden shrink-0 text-[12px] leading-none whitespace-nowrap text-muted-foreground 2xl:inline">on weft · mock</span>
    </Link>
  );
}
