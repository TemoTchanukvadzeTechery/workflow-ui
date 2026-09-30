/**
 * Class strings for the top navigation (docs/design/STYLE.md 3 and 6.1), on the globals.css
 * tokens. Kept here so the desktop bar and the mobile menu sheet draw the same pills.
 */

/** Circle buttons in the bar: 44px from 900px up, 40px below (CircleIconButton is 44px). */
export const CIRCLE_SIZE = "max-[899px]:size-10";

/** A text nav item: 15px text, 40px tall, 14px radius; hover is a well tint. */
export const NAV_ITEM =
  "relative inline-flex h-10 shrink-0 items-center gap-2 rounded-[14px] px-4 text-[15px] leading-none whitespace-nowrap outline-none transition-[background-color,color,box-shadow,filter] focus-visible:ring-3 focus-visible:ring-ring/50";
export const NAV_ITEM_IDLE = "text-foreground hover:bg-well";

/** The active item: the ink pill (Button's default variant). Text color set here, not by the utility, so nothing overrides it. */
export const NAV_ITEM_ACTIVE = "ink-surface font-medium text-ink-foreground hover:brightness-[1.12] dark:hover:brightness-[0.95]";

/** Count chip inside a nav item; on the ink pill it turns into a translucent tint of the ink text. */
export const NAV_COUNT = "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-semibold tabular-nums";
export const NAV_COUNT_IDLE = "bg-status-attention-bg text-status-attention-fg";
export const NAV_COUNT_ON_INK = "bg-ink-foreground/15 text-ink-foreground";
