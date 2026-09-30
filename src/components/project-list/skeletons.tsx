import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Table-shaped placeholder: name, stage bar, status and a few trailing cells per row. */
export function ProjectRowsSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("divide-y border-t", className)} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-12 items-center gap-4 px-5">
          <Skeleton className={cn("h-3.5", i % 2 ? "w-52" : "w-64", "max-w-[45%]")} />
          <Skeleton className="hidden h-1.5 w-36 sm:block" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <span className="flex-1" />
          <Skeleton className="hidden h-3.5 w-12 md:block" />
          <Skeleton className="hidden h-3.5 w-14 md:block" />
        </div>
      ))}
    </div>
  );
}

export function ProjectCardSkeleton() {
  return (
    <div className="card-surface flex flex-col gap-4 rounded-2xl p-5" aria-hidden>
      <Skeleton className="h-3 w-10" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-5 w-40 rounded-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}
