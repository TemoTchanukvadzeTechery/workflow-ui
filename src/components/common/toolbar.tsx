import type { ComponentProps, ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

export interface ToolbarGroupProps {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
  /** Default `group`; use "toolbar" when it holds several controls operated together. */
  role?: "group" | "toolbar";
}

/**
 * A page-level filter group (STYLE.md 3), like `[Jan 01 - July 31] compared to [Aug 01 - Dec 31]`:
 * a well track holding raised segments (ToolbarButton, or a SelectTrigger / Button placed
 * directly inside) separated by ToolbarText.
 */
export function ToolbarGroup({ children, className, role = "group", ...aria }: ToolbarGroupProps) {
  return (
    <div
      role={role}
      data-slot="toolbar-group"
      className={cn(
        "inline-flex h-11 max-w-full items-center gap-1 overflow-x-auto rounded-[16px] bg-well p-1 [scrollbar-width:none]",
        // Selects and buttons dropped straight in become raised segments.
        "[&>[data-slot=select-trigger]]:h-9! [&>[data-slot=select-trigger]]:rounded-[12px]! [&>[data-slot=select-trigger]]:border-0 [&>[data-slot=select-trigger]]:bg-raised [&>[data-slot=select-trigger]]:text-sm [&>[data-slot=select-trigger]]:shadow-(--raised-shadow)",
        "[&>[data-slot=button]]:h-9! [&>[data-slot=button]]:rounded-[12px]!",
        className,
      )}
      {...aria}
    >
      {children}
    </div>
  );
}

export interface ToolbarTextProps {
  children: ReactNode;
  className?: string;
}

/** Muted text between toolbar segments, e.g. "compared to". */
export function ToolbarText({ children, className }: ToolbarTextProps) {
  return <span className={cn("shrink-0 px-2.5 text-[13px] whitespace-nowrap text-muted-foreground", className)}>{children}</span>;
}

export interface ToolbarButtonProps extends ComponentProps<"button"> {
  /** Raised (default) or flat, muted text on the well. */
  raised?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/** A raised segment inside a ToolbarGroup. Forwards ref and props, so it works as a Radix trigger. */
export function ToolbarButton({ raised = true, className, type = "button", ...props }: ToolbarButtonProps) {
  return (
    <button
      type={type}
      data-slot="toolbar-button"
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-2 rounded-[12px] px-3 text-sm font-medium whitespace-nowrap outline-none transition-[color,background-color,box-shadow] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        raised ? "bg-raised text-heading shadow-(--raised-shadow) hover:bg-(--chip-bg)" : "text-muted-foreground hover:text-heading",
        className,
      )}
      {...props}
    />
  );
}
