import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface GlassTooltipItem {
  label: ReactNode;
  value: ReactNode;
  /** Render "value label" ("48.6k transactions") instead of "label: value" ("Conversion: 89%"). */
  valueFirst?: boolean;
}

export interface GlassTooltipProps {
  items: readonly GlassTooltipItem[];
  className?: string;
  /** Rendered element; default `div`. */
  as?: "div" | "span" | "p";
  id?: string;
}

/**
 * The reference's frosted readout, e.g. "48.6k transactions | Conversion: 89% | Drop-off: -11%":
 * 13px, muted labels, ink medium values, muted "|" separators. Static: position it yourself
 * (for a hover tooltip use TooltipContent, which has the same glass surface).
 */
export function GlassTooltip({ items, className, as: Comp = "div", id }: GlassTooltipProps) {
  return (
    <Comp
      id={id}
      data-slot="glass-tooltip"
      className={cn("glass inline-flex h-8 max-w-full items-center gap-1.5 rounded-full px-3.5 text-[13px] whitespace-nowrap text-muted-foreground", className)}
    >
      {items.map((it, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <span aria-hidden className="text-muted-foreground/60">
              |
            </span>
          )}
          <span className="inline-flex items-baseline gap-1">
            {it.valueFirst ? (
              <>
                <span className="font-medium text-heading tabular-nums">{it.value}</span>
                <span>{it.label}</span>
              </>
            ) : (
              <>
                <span>{it.label}:</span>
                <span className="font-medium text-heading tabular-nums">{it.value}</span>
              </>
            )}
          </span>
        </Fragment>
      ))}
    </Comp>
  );
}
