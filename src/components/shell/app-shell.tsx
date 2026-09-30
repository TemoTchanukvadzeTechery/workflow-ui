import type { ReactNode } from "react";
import { BreadcrumbRow } from "./breadcrumbs";
import { CommandPalette } from "./command-palette";
import { TopNav } from "./top-nav";

export interface AppShellProps {
  children: ReactNode;
}

/**
 * The frame every screen lives in (STYLE.md 1 and 6.1): one 1440px page container holding the
 * top navigation, a breadcrumb row on nested pages, and the single <main> landmark. The palette
 * is mounted once here and opened with ⌘K, the nav's search button or `openCommandPalette()`.
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <div className="relative flex min-h-svh flex-col bg-background">
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-primary px-3 py-1.5 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <div className="mx-auto flex w-full max-w-[1440px] min-w-0 flex-1 flex-col px-5 lg:px-8">
        <TopNav />
        <BreadcrumbRow className="-mt-2 mb-1" />
        <main id="main" tabIndex={-1} className="flex w-full min-w-0 flex-1 flex-col pt-3 pb-10 outline-none lg:pt-4 lg:pb-12">
          {children}
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
