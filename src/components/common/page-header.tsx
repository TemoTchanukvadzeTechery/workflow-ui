import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  /** Small uppercase label above the title, e.g. "Stage 2 of 5". */
  kicker?: ReactNode;
  title: ReactNode;
  /**
   * A small circle icon button beside the title, like the reference's "copy link" next to
   * "Overview": e.g. <CircleIconButton variant="raised" size="sm" icon={Link2} label="Copy link" />.
   */
  titleAction?: ReactNode;
  /** Muted paragraph under the title. */
  description?: ReactNode;
  /** Right-aligned controls (a ToolbarGroup, secondary buttons); wraps under the title on narrow screens. */
  actions?: ReactNode;
  /** Extra content under the header (filters, tabs, meta chips). */
  children?: ReactNode;
  /** "lg" (40-54px, overview pages) or "md" (32-40px, dense workspaces). */
  size?: "md" | "lg";
  className?: string;
}

/** Page title block (STYLE.md 2 and 6): a big regular-weight display title, tracked tight. */
export function PageHeader({ kicker, title, titleAction, description, actions, children, size = "lg", className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="flex min-w-0 flex-col gap-2">
          {kicker && <div className="kicker">{kicker}</div>}
          <div className="flex min-w-0 items-start gap-2.5">
            <h1
              className={cn(
                "min-w-0 font-normal break-words text-heading",
                size === "lg"
                  ? "text-[38px] leading-[1.08] tracking-[-0.03em] sm:text-[48px] sm:leading-[1.05] sm:tracking-[-0.035em] xl:text-[54px]"
                  : "text-[30px] leading-[1.12] tracking-[-0.025em] sm:text-[38px] sm:leading-[1.08] sm:tracking-[-0.03em] xl:text-[42px]",
              )}
            >
              {title}
            </h1>
            {titleAction && <div className="shrink-0 pt-0.5 sm:pt-1">{titleAction}</div>}
          </div>
          {description && <div className="max-w-3xl text-[15px] leading-6 text-muted-foreground">{description}</div>}
        </div>
        {actions && <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 md:justify-end">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
