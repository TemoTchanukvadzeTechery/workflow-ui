import { Activity, BrainCircuit, FolderKanban, House, Inbox, Settings, type LucideIcon } from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Active when the pathname is exactly href, or (for sections) starts with it. */
  match: (pathname: string) => boolean;
}

const section = (href: string) => (p: string) => p === href || p.startsWith(`${href}/`);

/** Primary navigation, shared by the top nav, its mobile menu and the command palette. */
export const NAV_ITEMS: readonly NavItem[] = [
  { title: "Home", href: "/", icon: House, match: (p) => p === "/" },
  { title: "Inbox", href: "/inbox", icon: Inbox, match: section("/inbox") },
  { title: "Projects", href: "/projects", icon: FolderKanban, match: section("/projects") },
  { title: "Runs", href: "/runs", icon: Activity, match: section("/runs") },
  { title: "Memory", href: "/memory", icon: BrainCircuit, match: section("/memory") },
  { title: "Settings", href: "/settings", icon: Settings, match: section("/settings") },
];
