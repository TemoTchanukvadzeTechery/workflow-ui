/**
 * The attention band on /memory (plan A3): shown only when signed-off documents drifted from
 * their accepted sha ("stale"). Names how many drifted and how many claims cite them, and links
 * to each document note. Hook-free and server-compatible.
 */
import { FileText, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { plural } from "@/lib/format";
import type { MemoryStaleEntry } from "@/lib/memory/types";
import { cn } from "@/lib/utils";

export interface MemoryStaleBandProps {
  stale: MemoryStaleEntry[];
  className?: string;
}

export function MemoryStaleBand({ stale, className }: MemoryStaleBandProps) {
  if (stale.length === 0) return null;
  const claims = stale.reduce((sum, e) => sum + e.claims, 0);
  return (
    <section role="status" aria-label="Drifted signed-off documents" className={cn("flex flex-col gap-2.5 rounded-[20px] bg-status-attention-bg px-5 py-4", className)}>
      <p className="flex items-start gap-2.5 text-sm leading-5 text-status-attention-fg">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
        <span>
          <span className="font-medium">{plural(stale.length, "signed-off document has", "signed-off documents have")} drifted</span> from the accepted version
          {claims > 0 ? <>; {plural(claims, "claim cites", "claims cite")} them and may be out of date</> : null}.
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-1.5 sm:pl-6.5">
        {stale.map((e) => (
          <Link
            key={e.document}
            href={`/memory/${e.document}`}
            title={e.path}
            className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-(--chip-bg) px-2.5 text-[13px] leading-none font-medium text-heading shadow-[0_0_0_1px_var(--chip-edge),0_1px_2px_rgb(0_0_0/0.06)] outline-none transition-[filter] hover:brightness-[0.98] focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:brightness-125"
          >
            <FileText aria-hidden className="size-3.5 shrink-0 text-status-attention-fg" strokeWidth={2} />
            <span className="truncate">{e.title ?? e.document}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
