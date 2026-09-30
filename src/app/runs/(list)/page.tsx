import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton } from "@/components/common";
import { RunsView } from "./_view";

export const metadata: Metadata = { title: "Runs" };

export default function RunsPage() {
  return (
    <Suspense fallback={<CardSkeleton rows={8} />}>
      <RunsView />
    </Suspense>
  );
}
