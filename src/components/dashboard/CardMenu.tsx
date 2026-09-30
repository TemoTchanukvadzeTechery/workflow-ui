"use client";

/**
 * The reference's circle "···" at the right of a card header, opening a short menu of where to
 * go from the card. Pass `href` alone (no items) for a single-destination circle arrow instead.
 */
import { ArrowUpRight, Ellipsis, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { CircleIconButton } from "@/components/common";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export interface CardMenuItem {
  label: string;
  href?: string;
  onSelect?: () => void;
  icon?: LucideIcon;
}

export interface CardMenuProps {
  /** Accessible name of the button, e.g. "Pipeline options". */
  label: string;
  items?: CardMenuItem[];
  /** With no items: the circle is a link (arrow icon) to this page. */
  href?: string;
  size?: "sm" | "md" | "lg";
}

export function CardMenu({ label, items, href, size = "lg" }: CardMenuProps) {
  if (!items?.length) {
    return href ? <CircleIconButton href={href} icon={ArrowUpRight} label={label} size={size} /> : null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <CircleIconButton icon={Ellipsis} label={label} size={size} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        {items.map((it) => {
          const Icon = it.icon;
          const body = (
            <>
              {Icon ? <Icon aria-hidden /> : null}
              {it.label}
            </>
          );
          return it.href ? (
            <DropdownMenuItem key={it.label} asChild>
              <Link href={it.href}>{body}</Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={it.label} onSelect={it.onSelect}>
              {body}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
