import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SectionCardProps {
  title?: ReactNode;
  /** Small uppercase caption above the title. Rare in the reference; prefer none. */
  kicker?: ReactNode;
  /** Muted line under the title. */
  description?: ReactNode;
  /** Right side of the header: buttons, a count, a "View all" link. */
  actions?: ReactNode;
  /**
   * The reference's circle button at the far right of the header ("···" or one action): pass a
   * <CircleIconButton>, or a DropdownMenu / Popover whose trigger is one (`asChild`).
   */
  cardMenu?: ReactNode;
  children?: ReactNode;
  /** "airy" (28px padding, overview pages) or "dense" (20px, stage/task/run pages). */
  density?: "airy" | "dense";
  /** Remove body padding, e.g. for a full-bleed table. The header keeps its padding. */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  /** Classes for the header row. */
  headerClassName?: string;
  /** Rendered element; default `section`. */
  as?: ElementType;
  id?: string;
}

/**
 * The reference card (STYLE.md 1): 28px radius, off-white surface with a box-shadow edge and
 * soft lift, a 22px medium title (20px on phones and dense pages) and an optional circle action
 * on the right, as in the reference's "Payments" and "Gross Volume" cards. Padding is 28px
 * on overview pages ("airy", 20px on phones) and 20px on dense pages.
 */
export function SectionCard({
  title,
  kicker,
  description,
  actions,
  cardMenu,
  children,
  density = "airy",
  flush,
  className,
  bodyClassName,
  headerClassName,
  as: Comp = "section",
  id,
}: SectionCardProps) {
  const airy = density === "airy";
  const padX = airy ? "px-5 sm:px-7" : "px-5";
  const padTop = airy ? "pt-5 sm:pt-7" : "pt-5";
  const padBottom = airy ? "pb-5 sm:pb-7" : "pb-5";
  const hasHeader = title || kicker || description || actions || cardMenu;
  return (
    <Comp id={id} data-slot="section-card" className={cn("card-surface flex min-w-0 flex-col rounded-2xl", className)}>
      {hasHeader && (
        <header
          className={cn(
            "flex justify-between gap-3",
            // A lone title lines up with the centre of a 44px circle button, as in the reference.
            cardMenu && !kicker && !description ? "items-center" : "items-start",
            padX,
            padTop,
            flush && (airy ? "pb-4 sm:pb-5" : "pb-4"),
            headerClassName,
          )}
        >
          <div className="flex min-w-0 flex-col gap-1">
            {kicker && <div className="kicker">{kicker}</div>}
            {title && (
              <h2
                className={cn(
                  "truncate font-medium tracking-[-0.015em] text-heading",
                  airy ? "text-[20px] leading-[1.25] sm:text-[22px] sm:leading-[1.2]" : "text-[18px] leading-6 sm:text-[20px] sm:leading-7",
                )}
              >
                {title}
              </h2>
            )}
            {description && <div className="text-[13px] leading-5 text-muted-foreground">{description}</div>}
          </div>
          {(actions || cardMenu) && (
            <div className="flex shrink-0 items-center gap-2">
              {actions}
              {cardMenu}
            </div>
          )}
        </header>
      )}
      <div
        className={cn(
          "min-w-0 flex-1",
          !flush && padX,
          !flush && padBottom,
          !flush && (hasHeader ? (airy ? "pt-4 sm:pt-5" : "pt-4") : padTop),
          bodyClassName,
        )}
      >
        {children}
      </div>
    </Comp>
  );
}
