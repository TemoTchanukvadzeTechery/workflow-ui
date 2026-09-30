import { CardSkeleton } from "@/components/common";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder in the overview's shape while the project bundle loads. */
export function OverviewSkeleton() {
  return (
    <div className="@container flex flex-col gap-4" aria-busy="true" aria-label="Loading the project overview">
      <div className="grid grid-cols-2 gap-2 @4xl:grid-cols-5" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="card-surface flex flex-col gap-3 rounded-[28px] p-4 last:col-span-2 @4xl:last:col-span-1">
            <Skeleton className="h-7 w-16 rounded-full" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 @5xl:grid-cols-3">
        <Skeleton className="h-[340px] rounded-[28px]" />
        <CardSkeleton rows={4} className="@5xl:col-span-2" />
      </div>
      <div className="grid grid-cols-2 gap-4 @3xl:grid-cols-3 @7xl:grid-cols-6" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="card-surface flex flex-col gap-5 rounded-[28px] p-5 sm:p-7">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-11 w-16" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 @5xl:grid-cols-5">
        <CardSkeleton rows={5} className="@5xl:col-span-2" />
        <CardSkeleton rows={5} className="@5xl:col-span-3" />
      </div>
    </div>
  );
}
