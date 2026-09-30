"use client";

/**
 * Small pieces shared by every "needs your attention" list (Home, Inbox, project overview):
 * how long an item has waited, its kind label, group icon and the mono run line of human items.
 *
 * The server's "awaiting_approval" tier holds real approvals (a gate, epics to accept) and
 * owner actions that start something ("Start the architecture run", "Run QA for 3 tasks"). The
 * UI shows those as two groups, Approvals and Ready to start; the tier ids stay as they are.
 */
import { CircleAlert, Eye, FileText, Flag, Layers, OctagonAlert, Play, TriangleAlert, type LucideIcon } from "lucide-react";
import { toneClasses } from "@/components/common";
import { useNow } from "@/hooks/use-now";
import type { InboxItem, InboxTier } from "@/lib/delivery/types";
import { formatDateTime, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { inboxItemText, inboxTierMeta, type Tone } from "@/lib/weft/labels";

export const INBOX_TIERS: readonly InboxTier[] = ["blocking_run", "awaiting_approval", "fyi"];

/** How the inbox groups items: the tiers, with awaiting_approval split into approvals and actions. */
export type InboxGroup = "blocking_run" | "approvals" | "ready_to_start" | "fyi";

export const INBOX_GROUPS: readonly InboxGroup[] = ["blocking_run", "approvals", "ready_to_start", "fyi"];

const GROUP_META: Record<InboxGroup, { label: string; tone: Tone; icon: LucideIcon }> = {
  blocking_run: { label: inboxTierMeta("blocking_run").label, tone: "attention", icon: CircleAlert },
  approvals: { label: "Approvals", tone: "review", icon: Eye },
  ready_to_start: { label: "Ready to start", tone: "running", icon: Play },
  fyi: { label: inboxTierMeta("fyi").label, tone: "neutral", icon: FileText },
};

export function inboxGroupMeta(group: InboxGroup): { label: string; tone: Tone; icon: LucideIcon } {
  return GROUP_META[group];
}

export function itemGroup(item: InboxItem): InboxGroup {
  if (item.tier === "awaiting_approval") return item.kind === "action" ? "ready_to_start" : "approvals";
  return item.tier;
}

/** Items in display order: group by group, keeping the server's order inside a group. */
export function orderByGroup(items: InboxItem[]): InboxItem[] {
  return INBOX_GROUPS.flatMap((g) => items.filter((i) => itemGroup(i) === g));
}

/** When the item started waiting: the request time for human items, `since` for the rest. */
export function itemSince(item: InboxItem): number {
  return item.kind === "human" ? item.entry.createdAt : item.since;
}

/** Full text of an item: the verbatim question for human requests, the title/text otherwise. */
export function itemText(item: InboxItem): string {
  return item.kind === "human" ? item.entry.question : inboxItemText(item);
}

/** "Review · task:review:1", "Stage gate", "Epics", "Action", "Warning". */
export function itemKindLabel(item: InboxItem): string {
  switch (item.kind) {
    case "human":
      return item.entry.kind === "review" ? "Review" : item.entry.kind === "approve" ? "Approval" : item.entry.kind === "confirm" ? "Confirmation" : "Question";
    case "stage-gate":
      return "Stage gate";
    case "epics":
      return "Epics";
    case "action":
      return "Ready to start";
    case "notice":
      return item.level === "error" ? "Error" : item.level === "warning" ? "Warning" : "Notice";
  }
}

export function itemIcon(item: InboxItem): { icon: LucideIcon; tone: Tone } {
  switch (item.kind) {
    case "human":
      return { icon: CircleAlert, tone: "attention" };
    case "stage-gate":
      return { icon: Flag, tone: "review" };
    case "epics":
      return { icon: Layers, tone: "review" };
    case "action":
      return { icon: Play, tone: "running" };
    case "notice":
      return item.level === "error" ? { icon: OctagonAlert, tone: "danger" } : item.level === "warning" ? { icon: TriangleAlert, tone: "attention" } : { icon: FileText, tone: "neutral" };
  }
}

/** Round tier/kind icon in its tone. */
export function ItemIcon({ item, className }: { item: InboxItem; className?: string }) {
  const { icon: Icon, tone } = itemIcon(item);
  const t = toneClasses(tone);
  return (
    <span aria-hidden className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full", t.bg, t.text, className)}>
      <Icon className="size-3.5" strokeWidth={2} />
    </span>
  );
}

export function GroupIcon({ group, className }: { group: InboxGroup; className?: string }) {
  const meta = inboxGroupMeta(group);
  return <meta.icon aria-hidden className={cn("size-3.5 shrink-0", toneClasses(meta.tone).text, className)} strokeWidth={2} />;
}

/** "5h 28m" since `since`, ticking every 30 s; the absolute time is in the title. */
export function WaitingFor({ since, prefix, className }: { since: number; prefix?: string; className?: string }) {
  const now = useNow(30_000);
  return (
    <span className={cn("whitespace-nowrap tabular-nums", className)} title={`Waiting since ${formatDateTime(since)}`} suppressHydrationWarning>
      {prefix ? `${prefix} ` : ""}
      {formatDuration(Math.max(0, now - since))}
    </span>
  );
}

/** The mono "workflow · runId · phase" line of a human item. */
export function RunLine({ item, className }: { item: Extract<InboxItem, { kind: "human" }>; className?: string }) {
  return (
    <span className={cn("block truncate font-mono text-[11px] text-muted-foreground", className)}>
      {item.entry.workflow} · {item.entry.runId}
      {item.phase ? ` · ${item.phase}` : ""}
      {item.key ? ` · ${item.key}` : ""}
    </span>
  );
}
