"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Tabs as TabsPrimitive } from "radix-ui"
import { useScrollFade } from "@/components/common/use-scroll-fade"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

/*
 * Every Tabs list is a segmented control (STYLE.md 3): a well track (16px radius, 4px padding,
 * 44px tall) with the active segment raised. `line` is kept for compatibility and renders the
 * same control. A horizontal list is always one row: when the tabs do not fit it scrolls
 * sideways with an edge fade (row-scroll-x) instead of wrapping into a second row.
 */
const tabsListVariants = cva(
  "group/tabs-list row-scroll-x inline-flex w-fit max-w-full min-w-0 items-center justify-start gap-1 rounded-[16px] bg-well p-1 text-muted-foreground group-data-horizontal/tabs:h-11 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:items-stretch",
  {
    variants: {
      variant: {
        default: "",
        line: "",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

/** Horizontal lists never wrap, even when a caller still passes flex-wrap / h-auto. */
const ONE_ROW = "flex-nowrap group-data-horizontal/tabs:h-11"

function TabsList({
  className,
  variant = "default",
  ref,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const fadeRef = useScrollFade<HTMLDivElement>()
  const setRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      if (typeof ref === "function") ref(el)
      else if (ref) ref.current = el
      const cleanup = fadeRef(el)
      return () => {
        cleanup?.()
        if (typeof ref === "function") ref(null)
        else if (ref) ref.current = null
      }
    },
    [ref, fadeRef]
  )
  return (
    <TabsPrimitive.List
      ref={setRef}
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className, ONE_ROW)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-full min-h-8 flex-1 items-center justify-center gap-1.5 rounded-[12px] border border-transparent px-3.5 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow] duration-150 group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-heading focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "data-active:bg-raised data-active:text-heading data-active:shadow-(--raised-shadow)",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
