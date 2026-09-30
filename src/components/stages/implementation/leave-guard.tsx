"use client";

/**
 * Warns before leaving a page that holds unsent edits: the browser's own prompt on reload, tab
 * close and external links (beforeunload), and a dialog for in-app links (a capture-phase click
 * listener stops the Link navigation, and Leave replays it with the router). Back/forward cannot
 * be intercepted, so callers also keep their draft (e.g. in sessionStorage) and restore it.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** The in-app destination of a click, when it should be held back; null to let it through. */
function heldHref(e: MouseEvent): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (!(a instanceof HTMLAnchorElement)) return null;
  if (a.target && a.target !== "_self") return null;
  if (a.hasAttribute("download")) return null;
  const url = new URL(a.href, window.location.href);
  // Other origins unload the page, so beforeunload asks instead.
  if (url.origin !== window.location.origin) return null;
  // Same page (a hash or the same query) keeps the edits.
  if (url.pathname === window.location.pathname && url.search === window.location.search) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function LeaveGuard({ active, title, body }: { active: boolean; title: string; body: string }) {
  const router = useRouter();
  const [held, setHeld] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers need returnValue set to show their prompt.
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      const href = heldHref(e);
      if (!href) return;
      e.preventDefault();
      e.stopPropagation();
      setHeld(href);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [active]);

  return (
    <AlertDialog open={held !== null} onOpenChange={(o) => !o && setHeld(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-full">Stay here</AlertDialogCancel>
          <AlertDialogAction
            className="rounded-full"
            onClick={() => {
              const href = held;
              setHeld(null);
              if (href) router.push(href);
            }}
          >
            Leave the page
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
