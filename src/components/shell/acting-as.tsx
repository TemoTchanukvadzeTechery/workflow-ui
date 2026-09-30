"use client";

import { ArrowRight, Info, Monitor, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useId, useState } from "react";
import { toast } from "sonner";
import { SegmentedControl } from "@/components/common/segmented-control";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DEFAULT_ACTOR, useActorName } from "@/lib/api/actor";
import { useSettings } from "@/lib/api/queries";
import type { DemoSpeed } from "@/lib/delivery/types";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Initials inside the reference's gradient ring (violet into red, orange and gold). */
export function RingAvatar({ name, size = 44, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        "inline-flex shrink-0 rounded-full p-[2px]",
        "bg-[conic-gradient(from_210deg,#3D3FD8,#7B3FE0_18%,#E8358A_38%,#F2552C_55%,#F59E0B_72%,#FFD36B_84%,#3D3FD8)]",
        className,
      )}
    >
      <span className="inline-flex size-full rounded-full bg-background p-[2px]">
        <span
          className={cn(
            "inline-flex size-full items-center justify-center rounded-full font-semibold tracking-[-0.02em] select-none",
            "bg-[radial-gradient(120%_120%_at_30%_20%,#FFFFFF,#E7F0FF_55%,#CFE0FB)] text-status-running-fg",
            "dark:bg-[radial-gradient(120%_120%_at_30%_20%,#2A3550,#1A2238)]",
          )}
          style={{ fontSize: Math.round(size * 0.3) }}
        >
          {initials(name)}
        </span>
      </span>
    </span>
  );
}

const SPEED_LABEL: Record<DemoSpeed, string> = { instant: "Instant", fast: "Fast", realistic: "Realistic" };

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

type ThemeValue = (typeof THEMES)[number]["value"];

/** Light / Dark / System as a segmented control (a well track, the chosen segment raised). */
function ThemeSegments() {
  const { theme, setTheme } = useTheme();
  const current: ThemeValue = theme === "light" || theme === "dark" ? theme : "system";
  return <SegmentedControl<ThemeValue> aria-label="Theme" size="sm" fullWidth value={current} onValueChange={setTheme} items={THEMES} />;
}

/**
 * "Acting as <name>": the avatar opens a popover with the display name (sent as `x-actor` and
 * recorded on every decision; there are no roles), the theme, and the demo speed and data
 * source, which link to Settings. A popover rather than a menu so the input keeps its keystrokes.
 */
export function ActingAs() {
  const [name, setName] = useActorName();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputId = useId();
  const settings = useSettings();

  const onOpenChange = (next: boolean) => {
    if (next) setDraft(name);
    setOpen(next);
  };

  const trimmed = draft.trim();
  const save = () => {
    if (!trimmed || trimmed === name) return;
    setName(trimmed);
    toast.success(`Acting as ${trimmed}`);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Acting as ${name}. Change name, theme and demo settings`}
          className="inline-flex shrink-0 rounded-full outline-none transition-transform hover:scale-[1.03] focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-100"
        >
          <RingAvatar name={name} size={44} className="max-[899px]:size-10!" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        className="w-[min(22rem,calc(100vw-2rem))] gap-4 rounded-[20px] p-5"
      >
        <div className="flex items-center gap-3">
          <RingAvatar name={name} size={48} />
          <div className="min-w-0">
            <div className="text-[13px] text-muted-foreground">Acting as</div>
            <div className="truncate text-[20px] leading-tight font-medium tracking-[-0.015em] text-heading">{name}</div>
          </div>
        </div>

        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label htmlFor={inputId} className="text-[13px] font-medium">
            Display name
          </label>
          <div className="flex gap-2">
            <Input
              id={inputId}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={DEFAULT_ACTOR}
              autoComplete="off"
              maxLength={60}
              className="h-10"
            />
            <Button type="submit" className="h-10 px-4" disabled={!trimmed || trimmed === name}>
              Save
            </Button>
          </div>
          <p className="flex gap-2 text-[13px] leading-5 text-muted-foreground">
            <Info aria-hidden className="mt-[3px] size-3.5 shrink-0" />
            <span>No roles yet: anyone can approve. Every decision records this name.</span>
          </p>
        </form>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">Theme</span>
          <ThemeSegments />
        </div>

        <Link
          href="/settings"
          onClick={() => setOpen(false)}
          className="group/set -mx-1 flex items-center gap-3 rounded-[14px] px-3 py-2.5 text-[13px] outline-none transition-colors hover:bg-well focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-muted-foreground">Demo speed and data source</span>
            <span className="mt-0.5 block font-medium text-heading">
              {settings.data ? `${SPEED_LABEL[settings.data.speed]} · ${settings.data.dataSource === "mock" ? "mock engine" : "weft daemon"}` : "Loading..."}
            </span>
          </span>
          <span className="inline-flex items-center gap-1 text-primary">
            Settings <ArrowRight aria-hidden className="size-3.5 transition-transform group-hover/set:translate-x-0.5" />
          </span>
        </Link>
      </PopoverContent>
    </Popover>
  );
}
