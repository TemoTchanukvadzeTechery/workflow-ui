"use client";

/**
 * Home header: today's date as the kicker, "Good morning, <acting-as name>" by local time of day,
 * and the primary New project button. Time and name are read after hydration (the server knows
 * neither the viewer's clock nor their localStorage name), with a same-size skeleton before.
 */
import { format } from "date-fns";
import { Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { useActorName } from "@/lib/api/actor";
import { useHydrated } from "@/lib/api/queries";

function partOfDay(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

export function GreetingHeader({ summary }: { summary?: ReactNode }) {
  const hydrated = useHydrated();
  const now = useNow(60_000);
  const [actor] = useActorName();

  return (
    <PageHeader
      kicker={hydrated ? format(now, "EEEE, MMMM d") : <span aria-hidden className="inline-block h-3 w-36 animate-pulse rounded-md bg-muted align-middle" />}
      title={
        hydrated ? (
          <>
            {partOfDay(new Date(now).getHours())}, <span className="text-muted-foreground">{actor}</span>
          </>
        ) : (
          <span aria-label="Loading" className="inline-block h-8 w-80 max-w-full animate-pulse rounded-md bg-muted align-middle" />
        )
      }
      description={summary}
      actions={
        <Button asChild className="h-9 rounded-full px-4">
          <Link href="/projects/new">
            <Plus aria-hidden />
            New project
          </Link>
        </Button>
      }
    />
  );
}
