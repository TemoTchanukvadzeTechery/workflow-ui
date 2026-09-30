"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface JsonViewProps {
  value: unknown;
  /**
   * true: only the root is open. A number: nodes at that depth and deeper start collapsed
   * (1 = root children collapsed). false/omitted: everything open.
   */
  collapsed?: boolean | number;
  /** Long strings are clipped here with a "show more" toggle. Default 400 chars. */
  maxStringLength?: number;
  className?: string;
}

/** A small recursive JSON viewer: mono 12px, collapsible objects and arrays, readable multi-line strings. */
export function JsonView({ value, collapsed = false, maxStringLength = 400, className }: JsonViewProps) {
  const collapseAt = collapsed === true ? 1 : collapsed === false ? Infinity : collapsed;
  return (
    <div className={cn("min-w-0 overflow-x-auto pl-4 font-mono text-xs leading-5 text-foreground", className)}>
      <JsonNode value={value} depth={0} collapseAt={collapseAt} last maxString={maxStringLength} />
    </div>
  );
}

interface NodeProps {
  name?: string;
  value: unknown;
  depth: number;
  collapseAt: number;
  last: boolean;
  maxString: number;
}

function JsonNode({ name, value, depth, collapseAt, last, maxString }: NodeProps) {
  const [open, setOpen] = useState(depth < collapseAt);
  const comma = last ? null : <span className="text-muted-foreground">,</span>;
  const key =
    name !== undefined ? (
      <>
        <span className="text-foreground">{JSON.stringify(name)}</span>
        <span className="text-muted-foreground">: </span>
      </>
    ) : null;

  if (value === null || typeof value !== "object") {
    return (
      <div className="break-words whitespace-pre-wrap">
        {key}
        <Primitive value={value} maxString={maxString} />
        {comma}
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: Array<[string | undefined, unknown]> = isArray ? value.map((v) => [undefined, v]) : Object.entries(value as Record<string, unknown>);
  const [openCh, closeCh] = isArray ? ["[", "]"] : ["{", "}"];

  if (entries.length === 0) {
    return (
      <div>
        {key}
        <span className="text-muted-foreground">
          {openCh}
          {closeCh}
        </span>
        {comma}
      </div>
    );
  }

  const summary = isArray ? `${formatNumber(entries.length)} ${entries.length === 1 ? "item" : "items"}` : `${formatNumber(entries.length)} ${entries.length === 1 ? "key" : "keys"}`;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="relative inline-flex max-w-full items-start rounded-sm text-left hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <ChevronRight aria-hidden className={cn("absolute top-[3px] -left-4 size-3.5 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-90")} />
        <span className="min-w-0">
          {key}
          <span className="text-muted-foreground">{openCh}</span>
          {!open && (
            <>
              <span className="mx-1 rounded bg-muted px-1 text-[11px] text-muted-foreground">{summary}</span>
              <span className="text-muted-foreground">{closeCh}</span>
              {comma}
            </>
          )}
        </span>
      </button>
      {open && (
        <>
          <div className="ml-[3px] border-l border-border pl-4">
            {entries.map(([k, v], i) => (
              <JsonNode key={k ?? i} name={k} value={v} depth={depth + 1} collapseAt={collapseAt} last={i === entries.length - 1} maxString={maxString} />
            ))}
          </div>
          <div>
            <span className="text-muted-foreground">{closeCh}</span>
            {comma}
          </div>
        </>
      )}
    </div>
  );
}

function Primitive({ value, maxString }: { value: unknown; maxString: number }) {
  const [full, setFull] = useState(false);
  if (value === null) return <span className="text-muted-foreground">null</span>;
  if (value === undefined) return <span className="text-muted-foreground italic">undefined</span>;
  if (typeof value === "boolean") return <span className="text-status-review-fg">{String(value)}</span>;
  if (typeof value === "number" || typeof value === "bigint") return <span className="text-status-running-fg tabular-nums">{String(value)}</span>;
  if (typeof value === "string") {
    const clip = !full && value.length > maxString;
    return (
      <span className="text-status-success-fg">
        &quot;{clip ? value.slice(0, maxString) : value}
        {clip ? (
          <button
            type="button"
            onClick={() => setFull(true)}
            className="mx-1 rounded bg-muted px-1 text-[11px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            +{formatNumber(value.length - maxString)} chars
          </button>
        ) : null}
        &quot;
      </span>
    );
  }
  return <span className="text-muted-foreground">{String(value)}</span>;
}
