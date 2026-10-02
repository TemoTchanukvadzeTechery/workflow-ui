"use client";

import {
  Activity,
  BrainCircuit,
  Check,
  CircleAlert,
  Compass,
  FlaskConical,
  FolderKanban,
  Inbox,
  Layers,
  ListChecks,
  Milestone,
  Settings,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { StatusPill } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toolByName } from "@/lib/assistant/tools";
import type { Choice, ToolCallPart, ToolEffect, ToolGroup } from "@/lib/assistant/types";
import { cn } from "@/lib/utils";
import { ResultBlocks } from "./result-blocks";

const GROUP_ICON: Record<ToolGroup, LucideIcon> = {
  navigation: Compass,
  session: UserRound,
  projects: FolderKanban,
  stages: Milestone,
  epics: Layers,
  tasks: ListChecks,
  qa: FlaskConical,
  inbox: Inbox,
  runs: Activity,
  memory: BrainCircuit,
  settings: Settings,
};

/** `**bold**` and `code` inside a line. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((seg, i) => {
    if (seg.startsWith("**") && seg.endsWith("**")) return <strong key={i} className="font-medium text-heading">{seg.slice(2, -2)}</strong>;
    if (seg.startsWith("`") && seg.endsWith("`")) return <code key={i} className="rounded-[5px] bg-well px-1 py-px font-mono text-[12px]">{seg.slice(1, -1)}</code>;
    return <Fragment key={i}>{seg}</Fragment>;
  });
}

/** The brain's text: paragraphs, "- " bullet lists, bold and code. */
export function MessageText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2 text-[14px] leading-[21px] text-foreground">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={i} className="flex list-disc flex-col gap-1 pl-4.5 marker:text-muted-foreground">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.slice(2))}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{inline(block)}</p>;
      })}
    </div>
  );
}

export function Choices({ options, onPick, disabled }: { options: readonly Choice[]; onPick: (reply: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={`${o.label}|${o.reply}`}
          type="button"
          disabled={disabled}
          onClick={() => onPick(o.reply)}
          className={cn(
            "inline-flex min-h-8 max-w-full items-center rounded-full bg-field px-3 py-1 text-left text-[13px] leading-[18px] text-heading",
            "shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.05)] outline-none transition-[background-color,box-shadow] dark:shadow-[0_0_0_1px_rgb(255_255_255/0.1)]",
            "hover:bg-well focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <span className="truncate">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

const EFFECT_PILL: Record<Exclude<ToolEffect, "read">, { label: string; tone: "attention" | "danger" }> = {
  write: { label: "Changes", tone: "attention" },
  destructive: { label: "Can't undo", tone: "danger" },
};

/**
 * One tool call. Proposed writes show what will happen and wait for Confirm; reads run at once
 * and show only their result. After it runs: the outcome line and the result blocks.
 */
export function ToolCallCard({ part, onConfirm, onCancel, onNavigate }: { part: ToolCallPart; onConfirm: () => void; onCancel: () => void; onNavigate?: () => void }) {
  const tool = toolByName(part.tool);
  const effect = tool?.effect ?? "write";
  const Icon = tool ? GROUP_ICON[tool.group] : CircleAlert;
  const isRead = effect === "read";

  // Reads: a quiet line saying what was looked up, then the answer.
  if (isRead) {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          {part.status === "running" ? <Spinner className="size-3.5" /> : part.status === "error" ? <CircleAlert aria-hidden className="size-3.5 text-status-danger-fg" /> : <Icon aria-hidden className="size-3.5" strokeWidth={1.75} />}
          <span className="truncate">{part.summary}</span>
        </div>
        {part.status === "error" && <p className="text-[13px] text-status-danger-fg">{part.error}</p>}
        {part.result && (
          <>
            {part.result.text && <MessageText text={part.result.text} />}
            {part.result.blocks?.length ? <ResultBlocks blocks={part.result.blocks} onNavigate={onNavigate} className="rounded-[18px] bg-field px-3.5 py-3 shadow-[0_0_0_1px_rgb(0_0_0/0.05)] dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08)]" /> : null}
          </>
        )}
      </div>
    );
  }

  const pill = EFFECT_PILL[effect as Exclude<ToolEffect, "read">];
  return (
    <section
      aria-label={part.summary}
      className={cn(
        "overflow-hidden rounded-[20px] bg-field shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_8px_20px_-14px_rgb(0_0_0/0.3)] dark:shadow-[0_0_0_1px_rgb(255_255_255/0.09)]",
        part.status === "proposed" && effect === "destructive" && "shadow-[0_0_0_1px_var(--status-danger-solid),0_8px_20px_-14px_rgb(0_0_0/0.3)]",
      )}
    >
      <header className="glass flex items-center gap-2 px-3.5 py-2.5 shadow-none">
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-well text-heading">
          <Icon aria-hidden className="size-3.5" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-heading">{tool?.title ?? part.tool}</span>
        {part.status === "proposed" && <StatusPill tone={pill.tone} label={pill.label} icon={null} size="sm" />}
        {part.status === "running" && <StatusPill tone="running" label="Running" pulse size="sm" />}
        {part.status === "done" && <StatusPill tone="success" label="Done" icon={Check} size="sm" />}
        {part.status === "error" && <StatusPill tone="danger" label="Failed" icon={CircleAlert} size="sm" />}
        {part.status === "cancelled" && <StatusPill tone="neutral" label="Cancelled" icon={X} size="sm" />}
      </header>
      <div className="flex flex-col gap-3 px-3.5 pt-3 pb-3.5">
        <p className="text-[14px] leading-5 font-medium text-heading">{part.summary}</p>
        {part.details.length > 0 && (
          <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
            {part.details.map((d) => (
              <div key={d.label} className="contents">
                <dt className="text-muted-foreground">{d.label}</dt>
                <dd className="min-w-0 break-words text-heading">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {part.status === "proposed" && part.preview?.length ? <ResultBlocks blocks={part.preview} onNavigate={onNavigate} /> : null}
        {part.status === "proposed" && part.blocked && <p className="text-[12.5px] leading-[18px] text-muted-foreground">{part.blocked}</p>}
        {part.status === "proposed" && (
          <div className="flex items-center gap-2 pt-0.5">
            <Button size="sm" variant={effect === "destructive" ? "destructive" : "default"} onClick={onConfirm} disabled={!!part.blocked}>
              {effect === "destructive" ? "Yes, do it" : "Confirm"}
            </Button>
            <Button size="sm" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}
        {part.status === "error" && <p className="text-[13px] leading-5 text-status-danger-fg">{part.error}</p>}
        {part.result && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            {part.result.text && <MessageText text={part.result.text} />}
            {part.result.blocks?.length ? <ResultBlocks blocks={part.result.blocks} onNavigate={onNavigate} /> : null}
          </div>
        )}
      </div>
    </section>
  );
}
