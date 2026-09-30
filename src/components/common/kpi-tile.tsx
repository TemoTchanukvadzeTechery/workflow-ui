import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/weft/labels";
import { FloatingChip } from "./floating-chip";

export interface KpiDelta {
  /** e.g. "+3 today", "15%". */
  label: string;
  trend?: "up" | "down" | "flat";
  /** Whether the change is good (success), bad (danger) or neither (neutral). Default neutral. */
  tone?: Tone;
}

export interface KpiTileProps {
  label: ReactNode;
  /** The big numeral. Pass a string/number or <Money usd={...} />. */
  value: ReactNode;
  /** A floating delta chip after the numeral ("▲ 15%"). */
  delta?: KpiDelta | string;
  /** Muted line at the bottom, e.g. "3 blocking a run". */
  hint?: ReactNode;
  icon?: LucideIcon;
  /** A circle button at the top right (e.g. <CircleIconButton icon={Ellipsis} label="More" />). Not with `href`. */
  cardMenu?: ReactNode;
  /** A sparkline or dot matrix, rendered between the numeral and `aside` (or under it on phones). */
  chart?: ReactNode;
  /** Right column, e.g. "vs last period" over "+34,002". */
  aside?: ReactNode;
  /** Makes the whole tile a link. */
  href?: string;
  /** "lg" = 44-52px numerals (default), "md" = 32-36px for dense rows. */
  size?: "md" | "lg";
  className?: string;
}

/**
 * A KPI card in the reference's style (Transactions / Customers): a muted 15px label, one big
 * regular-weight numeral, an optional floating delta chip, and optional chart and aside slots.
 */
export function KpiTile({ label, value, delta, hint, icon: Icon, cardMenu, chart, aside, href, size = "lg", className }: KpiTileProps) {
  const d: KpiDelta | undefined = typeof delta === "string" ? { label: delta } : delta;
  const lg = size === "lg";
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className={cn("leading-5 text-muted-foreground", lg ? "text-[15px]" : "text-[13px]")}>{label}</div>
        {Icon && !cardMenu && (
          <span className="-mt-1 -mr-1 inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-circle-border text-heading">
            <Icon aria-hidden className="size-4" strokeWidth={1.75} />
          </span>
        )}
        {cardMenu && <div className="-mt-2 -mr-2 shrink-0">{cardMenu}</div>}
      </div>
      <div className="flex min-w-0 flex-wrap items-end gap-x-5 gap-y-3">
        <div className="flex min-w-0 items-center gap-x-3 gap-y-2">
          <div
            className={cn(
              "font-normal text-heading tabular-nums",
              lg ? "text-[44px] leading-none tracking-[-0.04em] sm:text-[52px]" : "text-[32px] leading-none tracking-[-0.03em] sm:text-[36px]",
            )}
          >
            {value}
          </div>
          {d && <DeltaChip delta={d} />}
        </div>
        {chart && <div className="min-w-0 flex-1">{chart}</div>}
        {aside && <div className="ml-auto flex shrink-0 flex-col items-end gap-1 text-right">{aside}</div>}
      </div>
      {hint && <div className="mt-auto text-[13px] leading-5 text-muted-foreground">{hint}</div>}
    </>
  );

  const cls = cn("card-surface flex min-w-0 flex-col rounded-2xl", lg ? "gap-5 p-5 sm:p-7" : "gap-4 p-5", className);
  if (href) {
    return (
      <Link
        href={href}
        className={cn(cls, "transition-[box-shadow,transform] duration-150 hover:shadow-[var(--card-edge),0_20px_40px_-18px_rgb(0_0_0/0.18)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none")}
      >
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}

function DeltaChip({ delta }: { delta: KpiDelta }) {
  const tone = delta.tone ?? "neutral";
  const dir = delta.trend === "up" || delta.trend === "down" ? delta.trend : undefined;
  return <FloatingChip value={delta.label} tone={tone} delta={dir} className="shrink-0" />;
}
