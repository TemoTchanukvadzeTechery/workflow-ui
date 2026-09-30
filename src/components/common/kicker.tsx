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

/** Weft-style kicker: 10.5px uppercase, 0.12em tracking, muted. */
export function Kicker({ children, className, as: Comp = "div", tone = "muted" }: KickerProps) {
  return <Comp className={cn("kicker", tone === "primary" && "text-primary", className)}>{children}</Comp>;
}
