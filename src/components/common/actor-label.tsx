import { Bot, Cog, ShieldCheck } from "lucide-react";
import type { Actor } from "@/lib/delivery/types";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Plain-text actor name: "Priya", "weft · po-brd", "policy", "system". */
export function actorText(actor: Actor): string {
  switch (actor.kind) {
    case "human":
      return actor.name;
    case "agent":
      return actor.name.startsWith("weft") ? actor.name : `weft · ${actor.name}`;
    case "policy":
      return "policy";
    case "system":
      return "system";
  }
}

export interface InitialsAvatarProps {
  name: string;
  /** xs 16px, sm 20px, md 28px, lg 36px, xl 40px. */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** The reference avatar's gradient ring (orange through violet to blue), e.g. the top-bar avatar. */
  ring?: boolean;
  className?: string;
}

const AVATAR_SIZE = {
  xs: "size-4 text-[8px]",
  sm: "size-5 text-[9px]",
  md: "size-7 text-[11px]",
  lg: "size-9 text-[13px]",
  xl: "size-10 text-sm",
} as const;

/** Initials in a soft cobalt circle. No photos: the mock has no identities, only names. */
export function InitialsAvatar({ name, size = "sm", ring, className }: InitialsAvatarProps) {
  const circle = (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-semibold tracking-tight text-status-running-fg select-none",
        AVATAR_SIZE[size],
        ring && "ring-2 ring-background",
        !ring && className,
      )}
    >
      {initials(name)}
    </span>
  );
  if (!ring) return circle;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 rounded-full bg-[conic-gradient(from_200deg,#f26a1b,#ffb547,#e8358a,#7c5cff,#1b6ffc,#f26a1b)] p-[2px]",
        className,
      )}
    >
      {circle}
    </span>
  );
}

export interface ActorLabelProps {
  actor: Actor;
  /** Show the avatar/icon (default true). */
  showIcon?: boolean;
  size?: "xs" | "sm";
  className?: string;
}

/** Who did something: a person (initials + name), a weft agent (bot + mono workflow), policy or system. */
export function ActorLabel({ actor, showIcon = true, size = "sm", className }: ActorLabelProps) {
  const text = actorText(actor);
  const iconBox = cn("inline-flex shrink-0 items-center justify-center rounded-full bg-well text-muted-foreground", size === "xs" ? "size-4" : "size-5");
  const iconSize = size === "xs" ? "size-2.5" : "size-3";
  const title = actor.kind === "agent" && actor.model ? `${text} (${actor.model})` : text;

  return (
    <span title={title} className={cn("inline-flex min-w-0 items-center gap-1.5 align-middle", size === "xs" ? "text-xs" : "text-[13px]", className)}>
      {showIcon &&
        (actor.kind === "human" ? (
          <InitialsAvatar name={actor.name} size={size} />
        ) : (
          <span aria-hidden className={iconBox}>
            {actor.kind === "agent" ? <Bot className={iconSize} /> : actor.kind === "policy" ? <ShieldCheck className={iconSize} /> : <Cog className={iconSize} />}
          </span>
        ))}
      <span className={cn("truncate", actor.kind === "human" ? "text-foreground" : "font-mono text-muted-foreground", actor.kind !== "human" && (size === "xs" ? "text-[11px]" : "text-xs"))}>
        {text}
      </span>
    </span>
  );
}
