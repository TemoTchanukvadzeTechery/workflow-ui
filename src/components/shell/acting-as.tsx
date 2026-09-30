"use client";

import { ArrowRight, Info, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useId, useState } from "react";
import { toast } from "sonner";
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
            "bg-[radial-gradient(120%_120%_at_30%_20%,#FFFFFF,#E7F0FF_55%,#CFE0FB)] text-[#1558D6]",
            "dark:bg-[radial-gradient(120%_120%_at_30%_20%,#2A3550,#1A2238)] dark:text-[#A9C4F5]",
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

const THEMES: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** Light / Dark / System as a segmented control (a well track, the chosen segment raised). */
function ThemeSegments() {
  const { theme, setTheme } = useTheme();
  const current = theme ?? "system";
  return (
    <div role="group" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-[16px] bg-[#EAEAEA] p-1 dark:bg-[#232428]">
      {THEMES.map((t) => {
        const on = current === t.value;
        return (
          <button
            key={t.value}
            type="button"
            aria-pressed={on}
            onClick={() => setTheme(t.value)}
            className={cn(
              "inline-flex h-9 items-center justify-center gap-1.5 rounded-[12px] text-[13px] outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              on
                ? "bg-[#F8F8F8] font-medium text-[#0B0B0B] shadow-[0_1px_2px_rgba(0,0,0,.08),inset_0_1px_0_#fff] dark:bg-[#2C2D31] dark:text-[#F4F4F5] dark:shadow-none"
                : "text-[#6E6E6E] hover:text-[#1A1A1A] dark:text-[#A1A1AA] dark:hover:text-[#F4F4F5]",
            )}
          >
            <t.icon aria-hidden className="size-3.5" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
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
        className="w-[min(22rem,calc(100vw-2rem))] gap-4 rounded-[24px] border-0 bg-card p-5 shadow-[0_0_0_1px_rgba(0,0,0,.05),0_24px_60px_-20px_rgba(0,0,0,.28),inset_0_1px_0_rgba(255,255,255,.9)] ring-0 dark:shadow-[0_0_0_1px_rgba(255,255,255,.08),0_24px_60px_-20px_rgba(0,0,0,.7)]"
      >
        <div className="flex items-center gap-3">
          <RingAvatar name={name} size={48} />
          <div className="min-w-0">
            <div className="text-[13px] text-[#6E6E6E] dark:text-[#A1A1AA]">Acting as</div>
            <div className="truncate text-[20px] leading-tight font-medium tracking-[-0.015em] text-[#0B0B0B] dark:text-[#F4F4F5]">{name}</div>
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
              className="h-10 rounded-[14px] bg-white text-[15px] md:text-[15px] dark:bg-white/5"
            />
            <Button type="submit" className="h-10 rounded-[14px] px-4" disabled={!trimmed || trimmed === name}>
              Save
            </Button>
          </div>
          <p className="flex gap-2 text-[13px] leading-5 text-[#6E6E6E] dark:text-[#A1A1AA]">
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
          className="group/set -mx-1 flex items-center gap-3 rounded-[14px] px-3 py-2.5 text-[13px] outline-none transition-colors hover:bg-[#EAEAEA] focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:bg-white/[.06]"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[#6E6E6E] dark:text-[#A1A1AA]">Demo speed and data source</span>
            <span className="mt-0.5 block font-medium text-[#0B0B0B] dark:text-[#F4F4F5]">
              {settings.data ? `${SPEED_LABEL[settings.data.speed]} · ${settings.data.dataSource === "mock" ? "mock engine" : "weft daemon"}` : "Loading..."}
            </span>
          </span>
          <span className="inline-flex items-center gap-1 text-[#1558D6] dark:text-[#8CAFEE]">
            Settings <ArrowRight aria-hidden className="size-3.5 transition-transform group-hover/set:translate-x-0.5" />
          </span>
        </Link>
      </PopoverContent>
    </Popover>
  );
}
