"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/** True on macOS and iOS, for "⌘K" versus "Ctrl K" hints. False during SSR. */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false,
  );
}
