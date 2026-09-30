"use client";

import { Menu, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useSettings } from "@/lib/api/queries";
import { cn } from "@/lib/utils";
import { ActingAs } from "./acting-as";
import { Brand } from "./brand";
import { InboxBell, LiveIndicator, SearchButton, useInboxAttentionCount } from "./nav-actions";
import { NAV_ITEMS, type NavItem } from "./nav";
import { CIRCLE_BTN, NAV_COUNT, NAV_COUNT_IDLE, NAV_COUNT_ON_INK, NAV_ITEM, NAV_ITEM_ACTIVE } from "./nav-styles";
import { openCommandPalette } from "./palette-store";
import { useIsMac } from "./use-is-mac";

function NavLink({ item, active, count, onNavigate, className }: { item: NavItem; active: boolean; count?: number; onNavigate?: () => void; className?: string }) {
  return (
    <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn(NAV_ITEM, active && NAV_ITEM_ACTIVE, className)}>
      {item.title}
      {count != null && count > 0 && (
        <span className={cn(NAV_COUNT, active ? NAV_COUNT_ON_INK : NAV_COUNT_IDLE)}>
          <span aria-hidden>{count > 99 ? "99+" : count}</span>
          <span className="sr-only">, {count} need you</span>
        </span>
      )}
    </Link>
  );
}

/** Below 900px the nav items live in this sheet, opened by a circle menu button. */
function MobileMenu({ pathname, inboxCount }: { pathname: string; inboxCount: number }) {
  const [open, setOpen] = useState(false);
  const isMac = useIsMac();
  const settings = useSettings();
  const close = () => setOpen(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button type="button" aria-label="Open menu" className={cn(CIRCLE_BTN, "min-[900px]:hidden")}>
          <Menu aria-hidden strokeWidth={1.75} />
        </button>
      </SheetTrigger>
      <SheetContent side="right" showCloseButton={false} className="w-[min(20rem,86vw)] gap-0 border-0 bg-background p-0 shadow-[0_0_0_1px_rgba(0,0,0,.05),0_24px_60px_-20px_rgba(0,0,0,.35)] dark:shadow-[0_0_0_1px_rgba(255,255,255,.08)]">
        <SheetHeader className="h-[76px] flex-row items-center justify-between gap-3 px-5 py-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Pages of Delivery Flow</SheetDescription>
          <Brand onNavigate={close} className="[&>span:nth-child(2)]:text-[20px]" />
          <SheetClose asChild>
            <button type="button" aria-label="Close menu" className={CIRCLE_BTN}>
              <X aria-hidden strokeWidth={1.75} />
            </button>
          </SheetClose>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-6">
          <button
            type="button"
            onClick={() => {
              close();
              openCommandPalette();
            }}
            className="flex h-11 items-center gap-2.5 rounded-[14px] border border-[#E6E6E6] bg-white px-3.5 text-left text-[15px] text-[#6E6E6E] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:border-white/10 dark:bg-white/5 dark:text-[#A1A1AA]"
          >
            <Search aria-hidden className="size-4" strokeWidth={1.75} />
            <span className="flex-1">Search or jump to...</span>
            <Kbd className="h-5 rounded-md bg-[#EAEAEA] px-1.5 font-mono text-[10.5px] dark:bg-white/10">{isMac ? "⌘K" : "Ctrl K"}</Kbd>
          </button>
          <nav aria-label="Primary" className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={item.match(pathname)}
                count={item.href === "/inbox" ? inboxCount : undefined}
                onNavigate={close}
                className="h-11 justify-between px-4 text-[16px]"
              />
            ))}
          </nav>
          <div className="flex flex-col gap-1 border-t border-border pt-4">
            <LiveIndicator label="always" className="-ml-2.5 self-start" />
            {settings.data && (
              <Link
                href="/settings"
                onClick={close}
                className="rounded-[10px] px-0.5 py-1 text-[13px] text-[#6E6E6E] outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 dark:text-[#A1A1AA]"
              >
                Demo speed {settings.data.speed} · data source {settings.data.dataSource}
              </Link>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The top navigation (STYLE.md 6.1): brand on the left, text nav items centred with the active
 * one an ink pill, and search, inbox bell, live dot and the "Acting as" avatar on the right.
 * Below 900px the items move into a menu sheet.
 */
export function TopNav() {
  const pathname = usePathname();
  const inboxCount = useInboxAttentionCount();
  return (
    <header className="grid h-[76px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 min-[900px]:grid-cols-[1fr_auto_1fr] min-[900px]:gap-4">
      <Brand className="justify-self-start" />
      <nav aria-label="Primary" className="hidden items-center gap-1 min-[900px]:flex xl:gap-2">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} active={item.match(pathname)} count={item.href === "/inbox" ? inboxCount : undefined} className="max-lg:px-3.5" />
        ))}
      </nav>
      <div className="flex items-center justify-self-end gap-1.5 min-[900px]:gap-2.5">
        <LiveIndicator className="max-sm:hidden" />
        <SearchButton className="max-[419px]:hidden" />
        <InboxBell />
        <ActingAs />
        <MobileMenu pathname={pathname} inboxCount={inboxCount} />
      </div>
    </header>
  );
}
