"use client";

/**
 * Home header in the reference's shape: a big "Overview" with a copy-link circle beside it, a
 * muted greeting line ("Good afternoon, <acting-as name>") with the portfolio summary, and on the
 * right the period toolbar ("<range> compared to <previous range>") and New project. Time and
 * name are read after hydration (the server knows neither the viewer's clock nor their
 * localStorage name), with a same-size placeholder before.
 */
import { format } from "date-fns";
import { CalendarDays, Link2, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { CircleIconButton, PageHeader, ToolbarGroup, ToolbarText } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNow } from "@/hooks/use-now";
import { useActorName } from "@/lib/api/actor";
import { useHydrated } from "@/lib/api/queries";
import { PERIODS, type PeriodDays } from "./metrics";

const DAY = 24 * 3600_000;

function partOfDay(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/** "Sep 17 – Sep 30". */
function range(from: number, to: number): string {
  return `${format(from, "MMM d")} – ${format(to, "MMM d")}`;
}

function CopyLinkButton() {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link to the overview copied");
    } catch {
      toast.error("Could not copy the link");
    }
  };
  return <CircleIconButton variant="raised" size="sm" icon={Link2} label="Copy link to this page" onClick={() => void copy()} />;
}

export interface PeriodToolbarProps {
  period: PeriodDays;
  onPeriodChange: (p: PeriodDays) => void;
  /** Local midnight of the current day (the end of the period). */
  today: number;
  className?: string;
}

/** `[📅 Sep 17 – Sep 30 ▾] compared to [📅 Sep 3 – Sep 16]`: the period drives every chart on Home. */
export function PeriodToolbar({ period, onPeriodChange, today, className }: PeriodToolbarProps) {
  const from = today - (period - 1) * DAY;
  const prevTo = from - DAY;
  const prevFrom = from - period * DAY;
  return (
    <ToolbarGroup aria-label="Period" className={className}>
      <Select value={String(period)} onValueChange={(v) => onPeriodChange(Number(v) as PeriodDays)}>
        <SelectTrigger aria-label={`Period: last ${period} days`} size="sm" className="gap-2 pr-2.5 pl-3">
          <CalendarDays aria-hidden className="size-4 text-heading" strokeWidth={1.75} />
          <SelectValue>{range(from, today)}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start">
          {PERIODS.map((p) => (
            <SelectItem key={p} value={String(p)}>
              Last {p} days
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ToolbarText className="hidden sm:inline">compared to</ToolbarText>
      <span className="hidden h-9 shrink-0 items-center gap-2 rounded-[12px] bg-raised px-3 text-sm whitespace-nowrap text-heading shadow-(--raised-shadow) sm:inline-flex" title={`The ${period} days before`}>
        <CalendarDays aria-hidden className="size-4" strokeWidth={1.75} />
        <span className="sr-only">Previous period: </span>
        {range(prevFrom, prevTo)}
      </span>
    </ToolbarGroup>
  );
}

export interface GreetingHeaderProps {
  summary?: ReactNode;
  period: PeriodDays;
  onPeriodChange: (p: PeriodDays) => void;
  today: number;
}

export function GreetingHeader({ summary, period, onPeriodChange, today }: GreetingHeaderProps) {
  const hydrated = useHydrated();
  const now = useNow(60_000);
  const [actor] = useActorName();

  return (
    <PageHeader
      title="Overview"
      titleAction={<CopyLinkButton />}
      description={
        hydrated ? (
          <span>
            {partOfDay(new Date(now).getHours())}, <span className="text-heading">{actor}</span>
            {summary ? <span className="text-muted-foreground"> · {summary}</span> : null}
          </span>
        ) : (
          <span aria-hidden className="inline-block h-4 w-96 max-w-full animate-pulse rounded-md bg-well align-middle" />
        )
      }
      actions={
        <>
          <PeriodToolbar period={period} onPeriodChange={onPeriodChange} today={today} />
          <Button asChild variant="secondary" className="h-11 gap-2.5 px-4.5">
            <Link href="/projects/new">
              New project
              <Plus aria-hidden className="size-[18px]" strokeWidth={1.75} />
            </Link>
          </Button>
        </>
      }
    />
  );
}
