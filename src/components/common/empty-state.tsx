import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  body?: ReactNode;
  /** A button or link, e.g. <Button asChild><Link href="/projects/new">New project</Link></Button>. */
  action?: ReactNode;
  /** "sm" for inside cards and rails, "md" (default) for page-level empties. */
  size?: "sm" | "md";
  /** Draw a dashed outline (for empty drop zones and boards). */
  dashed?: boolean;
  className?: string;
}

/** Centered icon, title, one line of explanation and an optional action. */
export function EmptyState({ icon: Icon, title, body, action, size = "md", dashed, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "sm" ? "gap-2.5 px-4 py-7" : "gap-3.5 px-6 py-14",
        dashed && "rounded-xl border border-dashed border-circle-border",
        className,
      )}
    >
      {Icon && (
        <span className={cn("inline-flex items-center justify-center rounded-full border border-circle-border text-heading", size === "sm" ? "size-10" : "size-12")}>
          <Icon aria-hidden className={size === "sm" ? "size-4" : "size-5"} strokeWidth={1.75} />
        </span>
      )}
      <div className={cn("flex max-w-sm flex-col", size === "sm" ? "gap-0.5" : "gap-1")}>
        <p className={cn("font-medium text-heading", size === "sm" ? "text-sm" : "text-[17px] leading-6 tracking-[-0.01em]")}>{title}</p>
        {body && <div className={cn("text-muted-foreground", size === "sm" ? "text-[13px]" : "text-sm")}>{body}</div>}
      </div>
      {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
