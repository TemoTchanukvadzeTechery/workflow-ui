"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** Copy text to the clipboard; `copied` stays true for `resetMs` so the icon can flip to a check. */
export function useCopy(resetMs = 1_500): { copied: boolean; copy: (text: string, what?: string) => Promise<void> } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(
    async (text: string, what?: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), resetMs);
      } catch {
        toast.error(`Could not copy ${what ?? "to the clipboard"}`);
      }
    },
    [resetMs],
  );

  return { copied, copy };
}
