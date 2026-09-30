import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { isValidElement, type ComponentProps, type ReactElement, type Ref } from "react";
import { cn } from "@/lib/utils";

export interface CircleIconButtonProps extends Omit<ComponentProps<"button">, "children" | "ref"> {
  /** A lucide icon component, or an element for anything else (an avatar, a custom glyph). */
  icon: LucideIcon | ReactElement;
  /** Accessible name (the button has no visible text). */
  label: string;
  /** A small count bubble at the top right, e.g. the Inbox count on the bell. Hidden at 0. */
  badge?: number | string;
  /** The reference's small orange attention dot. */
  dot?: boolean;
  /** Renders a Next.js Link instead of a button. */
  href?: string;
  /** sm 32px, md 40px, lg 44px (default, the reference's header buttons). */
  size?: "sm" | "md" | "lg";
  /**
   * outline: hairline ring on transparent (default, the reference's "···", search and bell);
   * raised: a white lifted circle (the "copy link" button beside the page title);
   * ghost: no ring; ink: an ink pill circle.
   */
  variant?: "outline" | "raised" | "ghost" | "ink";
  /** React 19 ref prop, so the button works as a Radix trigger (`asChild`). */
  ref?: Ref<HTMLButtonElement | HTMLAnchorElement>;
}

const SIZE = { sm: "size-8", md: "size-10", lg: "size-11" } as const;
const ICON = { sm: "size-4", md: "size-[18px]", lg: "size-[18px]" } as const;

const VARIANT = {
  outline: "circle-btn",
  raised:
    "inline-flex shrink-0 items-center justify-center rounded-full bg-(--chip-bg) text-heading shadow-[0_0_0_1px_var(--chip-edge),0_4px_12px_-4px_rgb(0_0_0/0.18),inset_0_1px_0_rgb(255_255_255/0.9)] transition-[box-shadow,background-color] hover:shadow-[0_0_0_1px_var(--chip-edge),0_6px_16px_-4px_rgb(0_0_0/0.22),inset_0_1px_0_rgb(255_255_255/0.9)] dark:shadow-[0_0_0_1px_var(--chip-edge)]",
  ghost: "inline-flex shrink-0 items-center justify-center rounded-full text-heading transition-colors hover:bg-foreground/[0.05]",
  ink: "inline-flex shrink-0 items-center justify-center rounded-full bg-ink bg-(image:--ink-gradient) text-ink-foreground shadow-(--ink-shadow) transition-[filter] hover:brightness-[1.18] dark:hover:brightness-[0.94]",
} as const;

const BUTTON_ONLY = new Set(["disabled", "form", "formAction", "formEncType", "formMethod", "formNoValidate", "formTarget", "name", "value"]);

/** Everything but the button-only attributes (Radix trigger props, data-*, aria-* pass through). */
function anchorProps(props: object): Omit<ComponentProps<"a">, "href" | "ref"> {
  return Object.fromEntries(Object.entries(props).filter(([k]) => !BUTTON_ONLY.has(k)));
}

/**
 * A circular icon button (STYLE.md 3): 44px, 1px ring, transparent, 18px ink icon. Optional
 * count badge or attention dot. Forwards its ref and unknown props, so it can be a Radix trigger:
 * `<DropdownMenuTrigger asChild><CircleIconButton icon={Ellipsis} label="More" /></DropdownMenuTrigger>`.
 */
export function CircleIconButton({
  icon,
  label,
  badge,
  dot,
  href,
  size = "lg",
  variant = "outline",
  className,
  ref,
  type = "button",
  ...rest
}: CircleIconButtonProps) {
  const Icon = isValidElement(icon) ? null : (icon as LucideIcon);
  const showBadge = badge !== undefined && badge !== null && badge !== 0 && badge !== "";
  const badgeText = typeof badge === "number" && badge > 99 ? "99+" : badge;
  const name = showBadge ? `${label} (${badgeText})` : label;
  const cls = cn(
    "relative outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
    VARIANT[variant],
    SIZE[size],
    className,
  );
  const inner = (
    <>
      {Icon ? <Icon aria-hidden className={ICON[size]} strokeWidth={1.75} /> : (icon as ReactElement)}
      {showBadge ? (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#d2380c] px-1 text-[10px] leading-none font-semibold text-white tabular-nums ring-2 ring-background"
        >
          {badgeText}
        </span>
      ) : dot ? (
        <span aria-hidden className="absolute top-[26%] right-[27%] size-2 rounded-full bg-notify ring-2 ring-background" />
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link
        ref={ref as Ref<HTMLAnchorElement>}
        href={href}
        aria-label={name}
        data-slot="circle-icon-button"
        className={cls}
        {...anchorProps(rest)}
      >
        {inner}
      </Link>
    );
  }

  return (
    <button ref={ref as Ref<HTMLButtonElement>} type={type} aria-label={name} data-slot="circle-icon-button" className={cls} {...rest}>
      {inner}
    </button>
  );
}
