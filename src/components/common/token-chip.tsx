import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TokenChipProps {
  children: ReactNode;
  className?: string;
  title?: string;
}

/** An inline highlighted token such as `/successful payments` (STYLE.md 3): amber tint, 6px radius. */
export function TokenChip({ children, className, title }: TokenChipProps) {
  return (
    <span data-slot="token-chip" title={title} className={cn("token-chip", className)}>
      {children}
    </span>
  );
}
