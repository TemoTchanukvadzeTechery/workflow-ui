"use client";

import { Bell, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { CircleIconButton } from "@/components/common/circle-icon-button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLiveConnection } from "@/lib/api/live";
import { useInbox } from "@/lib/api/queries";
import { cn } from "@/lib/utils";
import { CIRCLE_SIZE } from "./nav-styles";
import { openCommandPalette } from "./palette-store";
import { useIsMac } from "./use-is-mac";

/** Inbox items that need a person: a run blocked on a question, or something awaiting approval. */
export function useInboxAttentionCount(): number {
  const inbox = useInbox();
  return (inbox.data ?? []).filter((i) => i.tier === "blocking_run" || i.tier === "awaiting_approval").length;
}

/** Circle search button; opens the command palette (also Cmd/Ctrl+K). */
export function SearchButton({ className }: { className?: string }) {
  const isMac = useIsMac();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <CircleIconButton icon={Search} label="Search" onClick={() => openCommandPalette()} aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"} className={cn(CIRCLE_SIZE, className)} />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Search or jump to <Kbd>{isMac ? "⌘K" : "Ctrl K"}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/** Circle bell linking to the Inbox; the orange-red dot shows while anything needs a person. */
export function InboxBell({ className }: { className?: string }) {
  const count = useInboxAttentionCount();
  const pathname = usePathname();
  const label = count > 0 ? `Inbox: ${count} ${count === 1 ? "item needs" : "items need"} you` : "Inbox: nothing needs you";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <CircleIconButton href="/inbox" icon={Bell} label={label} dot={count > 0} aria-current={pathname === "/inbox" ? "page" : undefined} className={cn(CIRCLE_SIZE, className)} />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * SSE state for /api/events. Connected: a small green dot (the word is in the tooltip and the
 * accessible name, and shows on very wide screens). Otherwise the amber pulsing dot also shows
 * its label, since that is the state a person needs to notice.
 */
export function LiveIndicator({ className, label: labelMode = "auto" }: { className?: string; /** "auto" (default) or "always" show the word. */ label?: "auto" | "always" }) {
  const conn = useLiveConnection();
  const open = conn === "open";
  const label = open ? "Live" : conn === "connecting" ? "Connecting" : "Reconnecting";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-label={`Live updates: ${label}`}
          tabIndex={0}
          className={cn(
            "inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-2.5 text-[13px] leading-none outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            open ? "text-status-success-fg" : "text-status-attention-fg",
            className,
          )}
        >
          <span className="relative inline-flex size-2.5 shrink-0">
            {!open && <span className="absolute inset-0 animate-ping rounded-full bg-status-attention-solid/60 motion-reduce:animate-none" />}
            <span
              className={cn(
                "relative inline-block size-2.5 rounded-full",
                open ? "bg-status-success-solid shadow-[0_0_0_3px_rgb(14_170_40/0.16)]" : "bg-status-attention-solid shadow-[0_0_0_3px_rgb(245_158_11/0.18)]",
              )}
            />
          </span>
          <span className={cn(labelMode === "auto" && (open ? "sr-only 2xl:not-sr-only" : "max-sm:sr-only"))}>{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{open ? "Live updates connected" : "Live updates disconnected; retrying every 2 s"}</TooltipContent>
    </Tooltip>
  );
}
