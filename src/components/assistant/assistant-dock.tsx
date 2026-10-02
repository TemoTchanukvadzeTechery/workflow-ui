"use client";

import { useSyncExternalStore } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useHotkey } from "@/hooks/use-hotkey";
import { closeAssistant, DOCK_INSET_PX, DOCK_MEDIA, setSheetOpen, toggleAssistant, useAssistantState } from "./assistant-store";
import { AssistantPanel } from "./assistant-panel";

function subscribeWide(onChange: () => void) {
  const mql = window.matchMedia(DOCK_MEDIA);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** Whether the screen is wide enough to dock the panel (false while server rendering). */
export function useDockWide(): boolean {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(DOCK_MEDIA).matches, () => false);
}

/** How far the page's right-edge overlays (toasts) move left while the panel is docked. */
export function useAssistantInset(): number {
  const { docked } = useAssistantState();
  return useDockWide() && docked ? DOCK_INSET_PX : 0;
}

/**
 * Where the assistant lives. Wide screens: a column pinned to the right of the page, which
 * narrows beside it (the column's space is shown by CSS from `<html data-assistant>`, so it is
 * there from first paint; its content mounts after hydration). Narrower screens: a sheet over
 * the page that closes when a link in it navigates. Cmd/Ctrl+J shows or hides it.
 */
export function AssistantDock() {
  const { docked, sheet } = useAssistantState();
  const wide = useDockWide();

  useHotkey(
    "j",
    (e) => {
      e.preventDefault();
      toggleAssistant();
    },
    { mod: true },
  );

  return (
    <>
      <aside data-assistant-dock aria-label="Assistant" className="sticky top-0 hidden h-svh w-[384px] shrink-0 flex-col py-3 pr-3">
        <div className="card-surface flex min-h-0 flex-1 flex-col rounded-[28px]">{docked && wide && <AssistantPanel className="flex-1" onClose={closeAssistant} />}</div>
      </aside>
      <Sheet open={sheet && !wide} onOpenChange={setSheetOpen}>
        <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[420px]">
          <SheetTitle className="sr-only">Assistant</SheetTitle>
          <SheetDescription className="sr-only">Ask about your projects or tell the assistant what to do.</SheetDescription>
          <AssistantPanel className="h-full" onClose={() => setSheetOpen(false)} onNavigate={() => setSheetOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
