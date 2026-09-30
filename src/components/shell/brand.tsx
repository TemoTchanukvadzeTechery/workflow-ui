import Link from "next/link";
import { cn } from "@/lib/utils";

/** The orange rounded-square mark (STYLE.md 4): a cream inset tile with an orange "next" arrow. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-[linear-gradient(135deg,#FFB547,#F26A1B)]",
        "shadow-[inset_0_1px_0_rgba(255,255,255,.45),inset_0_-1px_0_rgba(160,60,0,.25),0_4px_10px_-3px_rgba(242,106,27,.55)]",
        className,
      )}
    >
      <svg viewBox="0 0 28 28" className="size-full" fill="none">
        <rect x="6" y="6" width="16" height="16" rx="4" fill="#FFF6E4" />
        <path d="M6 22 22 6v12a4 4 0 0 1-4 4H6Z" fill="#FFD9A0" />
        <path d="M10.5 14h6.5M14.5 10.75 17.75 14l-3.25 3.25" stroke="#E4600F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** Mark and "Delivery Flow" wordmark, linking home. The "on weft · mock" note shows on wide screens. */
export function Brand({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      aria-label="Delivery Flow home"
      className={cn("group/brand inline-flex min-w-0 items-center gap-2.5 rounded-[14px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}
    >
      <BrandMark />
      <span className="truncate text-[20px] leading-none font-medium tracking-[-0.035em] text-heading sm:text-[26px]">Delivery Flow</span>
      <span className="mt-1.5 hidden shrink-0 text-[12px] leading-none whitespace-nowrap text-muted-foreground 2xl:inline">on weft · mock</span>
    </Link>
  );
}
