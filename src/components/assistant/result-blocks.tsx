"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusPill } from "@/components/common/status";
import { toneClasses } from "@/components/common/tone";
import { Markdown } from "@/components/docs/Markdown";
import { HumanRequestCard } from "@/components/hitl";
import type { ResultBlock, ResultItem } from "@/lib/assistant/types";
import { cn } from "@/lib/utils";

/** Rows shown before "Show N more". */
const ITEMS_SHOWN = 6;

function MaybeLink({ href, onNavigate, className, children }: { href?: string; onNavigate?: () => void; className?: string; children: React.ReactNode }) {
  if (!href) return <span className={className}>{children}</span>;
  return (
    <Link href={href} onClick={onNavigate} className={cn("rounded-[6px] outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50", className)}>
      {children}
    </Link>
  );
}

function ItemRow({ item, onNavigate }: { item: ResultItem; onNavigate?: () => void }) {
  return (
    <li className="flex min-w-0 items-start gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <MaybeLink href={item.href} onNavigate={onNavigate} className="block truncate text-[13.5px] font-medium text-heading">
          {item.title}
        </MaybeLink>
        {item.subtitle && <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[18px] text-muted-foreground">{item.subtitle}</p>}
      </div>
      {(item.status || item.meta) && (
        <div className="flex shrink-0 flex-col items-end gap-1">
          {item.status && <StatusPill tone={item.status.tone} label={item.status.label} icon={null} size="sm" />}
          {item.meta && <span className="text-[12px] whitespace-nowrap text-muted-foreground tabular-nums">{item.meta}</span>}
        </div>
      )}
    </li>
  );
}

function Items({ block, onNavigate }: { block: Extract<ResultBlock, { type: "items" }>; onNavigate?: () => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? block.items : block.items.slice(0, ITEMS_SHOWN);
  const hidden = block.items.length - shown.length;
  return (
    <div>
      {block.title && <p className="mb-2 text-[12px] font-medium text-muted-foreground">{block.title}</p>}
      {block.items.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{block.empty ?? "Nothing here."}</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((item, i) => (
            <ItemRow key={`${item.title}-${i}`} item={item} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
      {(hidden > 0 || block.more) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
          {hidden > 0 && (
            <button type="button" onClick={() => setAll(true)} className="inline-flex items-center gap-1 rounded-[6px] text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
              <ChevronDown aria-hidden className="size-3.5" />
              Show {hidden} more
            </button>
          )}
          {block.more && (
            <MaybeLink href={block.more.href} onNavigate={onNavigate} className="text-primary">
              {block.more.label}
            </MaybeLink>
          )}
        </div>
      )}
    </div>
  );
}

function Block({ block, onNavigate }: { block: ResultBlock; onNavigate?: () => void }) {
  switch (block.type) {
    case "items":
      return <Items block={block} onNavigate={onNavigate} />;
    case "facts":
      return (
        <div>
          {block.title && <p className="mb-2 text-[12px] font-medium text-muted-foreground">{block.title}</p>}
          <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
            {block.facts.map((f, i) => (
              <div key={`${f.label}-${i}`} className="contents">
                <dt className="text-muted-foreground">{f.label}</dt>
                <dd className="min-w-0 break-words text-heading">
                  <MaybeLink href={f.href} onNavigate={onNavigate}>
                    {f.value}
                  </MaybeLink>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      );
    case "text":
      return <p className={cn("text-[13px] leading-5", block.tone ? toneClasses(block.tone).text : "text-foreground")}>{block.text}</p>;
    case "markdown":
      return (
        <div>
          {(block.title || block.href) && (
            <div className="mb-2 flex items-center justify-between gap-3">
              {block.title && <p className="truncate text-[12px] font-medium text-muted-foreground">{block.title}</p>}
              {block.href && (
                <MaybeLink href={block.href} onNavigate={onNavigate} className="inline-flex shrink-0 items-center gap-1 text-[12px] text-primary">
                  Open <ExternalLink aria-hidden className="size-3" />
                </MaybeLink>
              )}
            </div>
          )}
          <div className="max-h-72 overflow-y-auto rounded-[14px] bg-background/60 px-3.5 py-3 ring-1 ring-border">
            <Markdown source={block.text} size="sm" />
          </div>
        </div>
      );
    case "links":
      return (
        <div className="flex flex-wrap gap-1.5">
          {block.links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={onNavigate}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-well px-3 text-[12.5px] text-heading outline-none hover:bg-well-hover focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {l.label}
            </Link>
          ))}
        </div>
      );
    case "request":
      return <HumanRequestCard runId={block.runId} request={block.request} projectId={block.projectId} workflow={block.request.workflow} compact />;
  }
}

/** A tool's result (or a confirmation preview) as compact blocks inside the chat. */
export function ResultBlocks({ blocks, onNavigate, className }: { blocks: readonly ResultBlock[]; onNavigate?: () => void; className?: string }) {
  if (!blocks.length) return null;
  return (
    <div className={cn("flex flex-col gap-3.5", className)}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} onNavigate={onNavigate} />
      ))}
    </div>
  );
}
