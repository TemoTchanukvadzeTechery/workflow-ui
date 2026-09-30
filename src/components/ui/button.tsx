import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/*
 * STYLE.md 3: default = the ink pill (like the reference's active "Home" nav item), secondary =
 * a well pill ("Daily", "Add widget"), outline = a hairline on transparent, ghost, link and a
 * soft destructive. Icon sizes are squares; add `rounded-full` for the reference's circle buttons
 * (or use CircleIconButton from components/common).
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,filter,opacity] duration-150 outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /*
         * Plain utilities rather than the ink-surface utility, so a className bg-* / shadow-*
         * replaces them. Disabled: a flat well pill with muted text instead of a faded ink pill,
         * which read as enabled in dark mode.
         */
        default:
          "bg-ink bg-(image:--ink-gradient) text-ink-foreground shadow-(--ink-shadow) hover:brightness-[1.18] dark:hover:brightness-[0.94] aria-expanded:brightness-[1.18] disabled:bg-well disabled:bg-none disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none",
        outline:
          "border-circle-border bg-transparent text-foreground hover:bg-foreground/[0.04] hover:text-foreground aria-expanded:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06]",
        secondary:
          "rounded-[16px] bg-well text-heading hover:bg-well-hover aria-expanded:bg-well-hover",
        ghost:
          "text-foreground hover:bg-foreground/[0.05] hover:text-foreground aria-expanded:bg-foreground/[0.05] dark:hover:bg-foreground/[0.07]",
        destructive:
          "bg-status-danger-bg text-status-danger-fg hover:bg-[color-mix(in_srgb,var(--status-danger-bg),var(--status-danger-fg)_8%)] focus-visible:ring-destructive/25 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-10 gap-2 px-4.5 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        xs: "h-7 gap-1 rounded-[10px] px-2.5 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 rounded-[12px] px-3 text-[13px] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-5 text-[15px] has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4 [&_svg:not([class*='size-'])]:size-[18px]",
        icon: "size-10 [&_svg:not([class*='size-'])]:size-[18px]",
        "icon-xs":
          "size-7 rounded-[10px] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm":
          "size-8 rounded-[12px] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-11 [&_svg:not([class*='size-'])]:size-[18px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
