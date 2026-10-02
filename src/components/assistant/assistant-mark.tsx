import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The assistant's avatar: a small orb in the Insights card's mesh colours (peach and coral into
 * blue, STYLE.md 5) with a white sparkle, so it reads as "the AI" without borrowing the orange
 * brand tile.
 */
export function AssistantMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-white",
        "bg-[radial-gradient(120%_120%_at_85%_10%,#F7B58A_0%,#F48A7A_32%,transparent_62%),radial-gradient(130%_130%_at_10%_95%,#1E3FAE_0%,#2A5BD7_45%,#6E7FE0_80%)]",
        "shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_4px_12px_-4px_rgb(42_91_215/0.55)]",
        className,
      )}
    >
      <Sparkles style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={1.9} />
    </span>
  );
}
