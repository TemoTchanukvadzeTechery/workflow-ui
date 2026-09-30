"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/utils";

export interface IdChipProps {
  /** The id shown and copied, e.g. a run id "0035d37f", "T-4", "CP-52153", a path. */
  id: string;
  /** Makes the id a link. */
  href?: string;
  /** Show a copy button (default true). */
  copy?: boolean;
  /** Visible text when it should differ from the copied id. */
  children?: ReactNode;
  /** Leading content inside the chip, e.g. a StatusDot. */
  leading?: ReactNode;
  size?: "sm" | "md";
  className?: string;
}

/** Mono id chip with an optional link and a copy button (weft's MonoBadge). */
export function IdChip({ id, href, copy = true, children, leading, size = "md", className }: IdChipProps) {
  const { copied, copy: doCopy } = useCopy();
  const text = children ?? id;
  const textCls = "min-w-0 truncate";

  return (
    <span
      data-slot="id-chip"
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1 rounded-[8px] bg-foreground/[0.05] font-mono text-muted-foreground tabular-nums dark:bg-foreground/[0.07]",
        size === "sm" ? "h-5 rounded-[6px] px-1.5 text-[11px]" : "h-6 px-2 text-xs",
        copy && (size === "sm" ? "pr-0.5" : "pr-1"),
        className,
      )}
    >
      {leading}
      {href ? (
        <Link href={href} className={cn(textCls, "text-foreground underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none")}>
          {text}
        </Link>
      ) : (
        <span className={cn(textCls, "text-foreground")}>{text}</span>
      )}
      {copy && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void doCopy(id, id);
          }}
          aria-label={copied ? `Copied ${id}` : `Copy ${id}`}
          title={copied ? "Copied" : "Copy"}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-(--chip-bg) hover:text-heading focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
            size === "sm" ? "size-4" : "size-5",
          )}
        >
          {copied ? <Check aria-hidden className="size-3 text-status-success-fg" /> : <Copy aria-hidden className="size-3" />}
        </button>
      )}
    </span>
  );
}
