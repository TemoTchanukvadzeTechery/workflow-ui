"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useAssistantInset } from "@/components/assistant";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api/client";
import { useLiveUpdates } from "@/lib/api/live";
import type { LiveEvent } from "@/lib/delivery/types";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Live updates (SSE) invalidate what changed, so a short staleTime is enough.
        staleTime: 2_000,
        refetchOnWindowFocus: false,
        // Retry once, but not on 4xx: a missing project or run will not appear on a retry.
        retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  // One client per mount, so server renders never share a cache between requests.
  const [client] = useState(makeQueryClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={250}>
          {children}
          <LiveUpdates />
          <AppToaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

/**
 * One SSE connection for the app; "notify" events become toasts with an Open action. live.ts
 * drops the ones the page already shows and batches bursts into one toast.
 */
function LiveUpdates() {
  const router = useRouter();
  useLiveUpdates((ev: Extract<LiveEvent, { type: "notify" }>) => {
    const href = ev.href;
    const opts = {
      description: ev.body,
      action: href ? { label: "Open", onClick: () => router.push(href) } : undefined,
    };
    if (ev.level === "attention") toast.warning(ev.title, opts);
    else if (ev.level === "error") toast.error(ev.title, opts);
    else if (ev.level === "success") toast.success(ev.title, opts);
    else toast.info(ev.title, opts);
  });
  return null;
}

/**
 * Top right, under the 48px top bar (bottom-right covered the sticky gate footer's buttons), and
 * left of the assistant while it is docked.
 */
function AppToaster() {
  const inset = useAssistantInset();
  return <Toaster position="top-right" offset={{ top: 60, right: 16 + inset }} mobileOffset={{ top: 56, left: 12, right: 12 }} closeButton />;
}
