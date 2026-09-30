import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface KickerProps {
  children: ReactNode;
  className?: string;
  /** Rendered element; default `div`. Use "h2"/"h3" when the kicker labels a section. */
  as?: ElementType;
  /** "primary" tints the kicker cobalt, for the one accented label on a card. */
  tone?: "muted" | "primary";
}

/** Tiny uppercase caption (11px, 0.1em tracking, muted). Rare in the reference: section captions only. */
export function Kicker({ children, className, as: Comp = "div", tone = "muted" }: KickerProps) {
  return <Comp className={cn("kicker", tone === "primary" && "text-primary", className)}>{children}</Comp>;
}
