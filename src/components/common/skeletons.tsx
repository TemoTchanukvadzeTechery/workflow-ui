import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Placeholder for a SectionCard body while its query loads. */
export function CardSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("card-surface flex flex-col gap-3.5 rounded-2xl p-5 sm:p-7", className)} aria-hidden>
      <Skeleton className="mb-1 h-5 w-1/3" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i % 3 === 2 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** Whole-page placeholder: header, a KPI row and two cards. Used by loading.tsx and slow views. */
export function PageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-6", className)} aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-12 w-72 max-w-full sm:h-14" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card-surface flex flex-col gap-5 rounded-2xl p-5 sm:p-7" aria-hidden>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-12 w-24" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CardSkeleton rows={6} className="lg:col-span-2" />
        <CardSkeleton rows={6} />
      </div>
    </div>
  );
}
