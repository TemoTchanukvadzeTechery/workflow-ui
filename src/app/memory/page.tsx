import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/common";
import { MemoryView } from "./_view";

export const metadata: Metadata = { title: "Memory" };

/** The tab lives in `?view=` (useSearchParams), so the view renders inside a Suspense boundary. */
export default function MemoryPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MemoryView />
    </Suspense>
  );
}
