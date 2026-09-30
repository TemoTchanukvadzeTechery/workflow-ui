"use client";

import { House, RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Route error boundary (Next 16 passes `retry`, not `reset`). The shell stays usable around it. */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div role="alert" className="card-surface flex w-full max-w-lg flex-col items-center gap-4 rounded-2xl px-6 py-10 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-status-danger-bg text-status-danger-fg">
          <TriangleAlert aria-hidden className="size-5" strokeWidth={1.75} />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-normal tracking-[-0.02em]">This page failed to load</h1>
          <p className="text-sm text-muted-foreground">Something went wrong while rendering it. Your data is safe; try again, or go back home.</p>
        </div>
        {(error.message || error.digest) && (
          <pre className="max-h-40 w-full overflow-auto rounded-lg bg-muted px-3 py-2 text-left font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {error.message}
            {error.digest ? `\ndigest ${error.digest}` : ""}
          </pre>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button className="rounded-full" onClick={() => retry()}>
            <RefreshCw aria-hidden />
            Try again
          </Button>
          <Button variant="outline" className="rounded-full" asChild>
            <Link href="/">
              <House aria-hidden />
              Home
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
