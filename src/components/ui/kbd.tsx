import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-[6px] bg-well px-1.5 font-sans text-[11px] font-medium text-muted-foreground shadow-[inset_0_-1px_0_rgb(0_0_0/0.06)] select-none in-data-[slot=tooltip-content]:bg-foreground/[0.07] in-data-[slot=tooltip-content]:text-foreground in-data-[slot=tooltip-content]:shadow-none dark:shadow-none [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
