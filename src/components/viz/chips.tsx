import { Fragment, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One segment of a glass tooltip: "48.6k transactions" (value first) or "Conversion: 89%" (labelFirst). */
export interface GlassItem {
  value: ReactNode;
  label?: ReactNode;
  /** Put the label first, followed by a colon: "Conversion: 89%". Default: value first. */
  labelFirst?: boolean;
}

/** Tone of a floating chip's shadow (STYLE.md 3: `0 6px 16px -6px rgb(<tone> / .35)`). */
export type ChipTone = "pink" | "green" | "blue" | "neutral";

const CHIP_TONE: Record<ChipTone, string> = {
  pink: "232 53 138",
  green: "13 170 44",
  blue: "25 118 255",
  neutral: "0 0 0",
};

/** White floating pill for chart call-outs ("42%", "Peak: Wed"): muted label, ink value. */
export function VizChip({ label, value, tone = "neutral", className, style }: { label?: ReactNode; value: ReactNode; tone?: ChipTone; className?: string; style?: CSSProperties }) {
  return (
    <span
      className={cn(
        "inline-flex h-[30px] items-center gap-1 rounded-full bg-white px-3 text-[13px] leading-none whitespace-nowrap",
        "shadow-[0_0_0_1px_rgba(0,0,0,.06),0_6px_16px_-6px_rgb(var(--chip-tone)/.35),0_1px_2px_rgba(0,0,0,.06)]",
        "dark:bg-[#26272B] dark:shadow-[0_0_0_1px_rgba(255,255,255,.08),0_6px_16px_-6px_rgb(var(--chip-tone)/.45)]",
        className,
      )}
      style={{ "--chip-tone": CHIP_TONE[tone], ...style } as CSSProperties}
    >
      {label != null && <span className="text-[#6E6E6E] dark:text-[#A1A1AA]">{label}:</span>}
      <span className="font-medium text-[#0B0B0B] dark:text-[#F4F4F5]">{value}</span>
    </span>
  );
}

/** Frosted glass pill (STYLE.md 3): translucent white, white edge, muted `|` separators. */
export function GlassPill({ items, id, className, style }: { items: GlassItem[]; id?: string; className?: string; style?: CSSProperties }) {
  return (
    <div
      id={id}
      role="tooltip"
      className={cn(
        "inline-flex min-h-8 max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-[16px] px-3.5 py-1.5 text-[13px] leading-[18px]",
        "bg-white/72 backdrop-blur-md backdrop-saturate-150",
        "shadow-[inset_0_0_0_1px_rgba(255,255,255,.9),0_0_0_1px_rgba(0,0,0,.06),0_12px_28px_-12px_rgba(20,50,120,.35)]",
        "dark:bg-[#1E1F23]/78 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,.08),0_0_0_1px_rgba(0,0,0,.4),0_12px_28px_-12px_rgba(0,0,0,.6)]",
        className,
      )}
      style={style}
    >
      {items.map((it, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <span aria-hidden className="text-[#BDBDBD] dark:text-[#55575E]">
              |
            </span>
          )}
          <span className="whitespace-nowrap">
            {it.labelFirst ? (
              <>
                {it.label != null && <span className="text-[#5F5F5F] dark:text-[#A1A1AA]">{it.label}: </span>}
                <span className="font-medium text-[#0B0B0B] dark:text-[#F4F4F5]">{it.value}</span>
              </>
            ) : (
              <>
                <span className="font-medium text-[#0B0B0B] dark:text-[#F4F4F5]">{it.value}</span>
                {it.label != null && <span className="text-[#5F5F5F] dark:text-[#A1A1AA]"> {it.label}</span>}
              </>
            )}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
