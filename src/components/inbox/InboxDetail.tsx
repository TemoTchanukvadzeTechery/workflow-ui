"use client";

/**
 * The inbox's right pane: the selected item in full. Human requests are answerable in place
 * (HumanRequestCard); gates list their blockers and warnings; everything links to where it lives.
 */
import { ArrowLeft, ArrowRight, CircleX, ExternalLink, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { RelativeTime, StatusPill } from "@/components/common";
import { HumanRequestCard } from "@/components/hitl";
import { Button } from "@/components/ui/button";
import { stageDef, type InboxItem } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { StageChip } from "../project-list/StageChip";
import { inboxGroupMeta, itemGroup, itemKindLabel, itemSince, WaitingFor } from "./bits";

export interface InboxDetailProps {
  item: InboxItem;
  /** Narrow layouts: show a back button that returns to the list. */
  onBack?: () => void;
  /** A human request was answered here (the inbox then moves on to the next item). */
  onAnswered?: () => void;
  className?: string;
}

function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild size="lg">
      <Link href={href}>
        {children}
        <ArrowRight aria-hidden />
      </Link>
    </Button>
  );
}

function Bullets({ title, items, icon: Icon, tone }: { title: string; items: string[]; icon: typeof CircleX; tone: "danger" | "attention" }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-[13px] font-medium text-muted-foreground">{title}</h3>
      <ul className="space-y-1">
        {items.map((b) => (
          <li key={b} className="flex gap-2 text-sm leading-5">
            <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", tone === "danger" ? "text-status-danger-fg" : "text-status-attention-fg")} />
            <span className="min-w-0">{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Body({ item, onAnswered }: { item: InboxItem; onAnswered?: () => void }) {
  const def = stageDef(item.stage);
  switch (item.kind) {
    case "human": {
      const toTask = item.href.includes("/tasks/");
      return (
        <div className="space-y-4">
          {/* One frame: the request card is bare and bleeds to this card's padding, so its glass strip spans the card and its text lines up with the header. */}
          <HumanRequestCard key={item.id} bare className="-mx-5 sm:-mx-6" runId={item.entry.runId} request={item.entry} workflow={item.entry.workflow} projectId={item.projectId} onAnswered={onAnswered} />
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="secondary">
              <Link href={item.href}>
                {toTask ? `Open task ${item.taskId ?? ""}`.trim() : `Open in ${def.title}`}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="ghost" className="text-muted-foreground">
              <Link href={`/runs/${item.entry.runId}`}>
                <ExternalLink aria-hidden />
                Run {item.entry.runId}
              </Link>
            </Button>
          </div>
        </div>
      );
    }
    case "stage-gate":
      return (
        <div className="space-y-4">
          <h2 className="text-[22px] leading-7 font-medium tracking-[-0.015em] text-heading">{item.title}</h2>
          <p className="text-sm text-muted-foreground">
            Stage {def.n} of 5 · {def.title} · owned by {def.owner}. No roles yet: anyone can approve, and the decision records your name.
          </p>
          {item.blockers.length ? <Bullets title="Blockers: the gate stays disabled until these are resolved" items={item.blockers} icon={CircleX} tone="danger" /> : null}
          {item.warnings.length ? <Bullets title="Warnings: tick each one at the gate to approve anyway" items={item.warnings} icon={TriangleAlert} tone="attention" /> : null}
          {!item.blockers.length && !item.warnings.length ? <p className="text-sm text-foreground/90">Nothing blocks the gate. It is ready for a decision.</p> : null}
          <PrimaryLink href={item.href}>Open the gate</PrimaryLink>
        </div>
      );
    case "epics":
      return (
        <div className="space-y-4">
          <h2 className="text-[22px] leading-7 font-medium tracking-[-0.015em] text-heading">
            {item.count} {item.count === 1 ? "epic" : "epics"} to accept
          </h2>
          <p className="text-sm leading-6 text-foreground/90">
            {item.stage === "architecture"
              ? "architect-aad updated epics from the accepted AAD. Review the changes and accept them before approving Architecture."
              : "po-brd proposed epics from the accepted BRD. Review, edit and accept them, then create them in Jira (mock) before approving Requirements."}
          </p>
          <PrimaryLink href={item.href}>Review epics</PrimaryLink>
        </div>
      );
    case "action":
      return (
        <div className="space-y-4">
          <h2 className="text-[22px] leading-7 font-medium tracking-[-0.015em] text-heading">{item.title}</h2>
          <p className="text-sm leading-6 text-foreground/90">
            Stage {def.n} of 5 · {def.title}. Nothing runs until someone starts it; the {def.owner} usually does.
          </p>
          <PrimaryLink href={item.href}>Open {def.title}</PrimaryLink>
        </div>
      );
    case "notice":
      return (
        <div className="space-y-4">
          <StatusPill tone={item.level === "error" ? "danger" : item.level === "warning" ? "attention" : "neutral"} label={itemKindLabel(item)} icon={item.level === "info" ? null : item.level === "error" ? CircleX : TriangleAlert} size="sm" />
          <p className="text-[15px] leading-6 text-foreground">{item.text}</p>
          <PrimaryLink href={item.href}>Open</PrimaryLink>
        </div>
      );
  }
}

export function InboxDetail({ item, onBack, onAnswered, className }: InboxDetailProps) {
  const tier = inboxGroupMeta(itemGroup(item));
  return (
    <article aria-label="Selected item" className={cn("card-surface flex min-w-0 flex-col gap-5 rounded-[28px] p-5 sm:p-7", className)}>
      {onBack ? (
        <Button variant="secondary" size="sm" onClick={onBack} className="self-start @4xl:hidden">
          <ArrowLeft aria-hidden />
          Back to the inbox
        </Button>
      ) : null}
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <StatusPill tone={tier.tone} icon={tier.icon} label={tier.label} />
        <Link href={`/projects/${encodeURIComponent(item.projectId)}`} className="min-w-0 truncate text-sm font-medium text-heading underline-offset-2 hover:underline">
          {item.projectName}
        </Link>
        <StageChip stage={item.stage} numbered />
        <span className="flex-1" />
        {item.kind === "human" ? null : item.tier === "fyi" ? (
          <RelativeTime at={itemSince(item)} className="text-[13px] text-muted-foreground" />
        ) : (
          <WaitingFor since={itemSince(item)} prefix="Waiting" className="text-[13px] text-muted-foreground" />
        )}
      </header>
      <Body item={item} onAnswered={onAnswered} />
    </article>
  );
}
