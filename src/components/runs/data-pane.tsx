"use client";

/**
 * Weft's DataPane: a titled box around a step's input or output with a Structured / JSON
 * switch. Structured renders top-level fields as rows; long strings render as Markdown when
 * they look like Markdown, else as a mono block; blob refs load on demand.
 */
import { FileText } from "lucide-react";
import { useState, type ReactNode } from "react";
import { JsonView } from "@/components/common";
import { Markdown } from "@/components/docs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBlobText } from "@/lib/api/queries";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BlobRef } from "@/lib/weft/types";

export interface DataPaneProps {
  /** e.g. "step input". */
  title: string;
  /** e.g. "as scheduled". */
  note?: ReactNode;
  value: unknown;
  /** Shown when value is undefined. */
  emptyText?: string;
  /** Start in JSON mode. */
  defaultMode?: "structured" | "json";
  className?: string;
  /** Extra header content, right side. */
  actions?: ReactNode;
}

export function isBlobRef(v: unknown): v is BlobRef {
  return !!v && typeof v === "object" && typeof (v as BlobRef).$blob === "string" && typeof (v as BlobRef).size === "number";
}

/** Heuristic: headings, lists, tables or fenced code make a string Markdown. */
export function looksLikeMarkdown(s: string): boolean {
  if (s.length < 40) return false;
  return /^#{1,6}\s|^\s*[-*]\s+\S|^\s*\d+\.\s+\S|^\|.+\|\s*$|^```|\*\*[^*]+\*\*/m.test(s);
}

export function DataPane({ title, note, value, emptyText = "Nothing recorded.", defaultMode = "structured", className, actions }: DataPaneProps) {
  const [mode, setMode] = useState<"structured" | "json">(defaultMode);
  const empty = value === undefined;
  const simple = value === null || typeof value !== "object" || isBlobRef(value);

  return (
    <div className={cn("min-w-0 overflow-hidden rounded-[16px] bg-field shadow-[0_0_0_1px_var(--rule)]", className)}>
      <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 border-b border-rule py-1.5 pr-1.5 pl-4">
        <span className="text-[13px] font-medium text-heading">{title}</span>
        {note && <span className="text-[13px] text-muted-foreground">{note}</span>}
        <span className="flex-1" />
        {actions}
        {!empty && !simple && (
          <div role="radiogroup" aria-label={`${title} view`} className="inline-flex h-8 items-center gap-0.5 rounded-[10px] bg-well p-[3px]">
            {(["structured", "json"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "h-full rounded-[8px] px-2.5 text-xs font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  mode === m ? "bg-raised text-heading shadow-(--raised-shadow)" : "text-muted-foreground hover:text-heading",
                )}
              >
                {m === "structured" ? "Structured" : "JSON"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="relative max-h-[560px] min-w-0 overflow-auto p-4">
        {empty ? (
          <p className="text-[13px] text-muted-foreground">{emptyText}</p>
        ) : mode === "json" && !simple ? (
          <JsonView value={value} collapsed={3} maxStringLength={1200} />
        ) : (
          <StructuredValue value={value} />
        )}
      </div>
    </div>
  );
}

function StructuredValue({ value }: { value: unknown }) {
  if (value === null) return <span className="font-mono text-xs text-muted-foreground">null</span>;
  if (isBlobRef(value)) return <BlobValue blob={value} />;
  if (typeof value === "string") return <StringValue text={value} />;
  if (typeof value !== "object") return <span className="font-mono text-xs">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="font-mono text-xs text-muted-foreground">[] empty list</span>;
    if (value.every((v) => typeof v === "string" && v.length < 200)) {
      return (
        <ul className="flex flex-col gap-1">
          {(value as string[]).map((v, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-5">
              <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" />
              <span className="min-w-0 break-words">{v}</span>
            </li>
          ))}
        </ul>
      );
    }
    return <JsonView value={value} collapsed={2} maxStringLength={600} />;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return <span className="font-mono text-xs text-muted-foreground">{"{}"} no fields</span>;
  return (
    <dl className="flex flex-col divide-y divide-rule">
      {entries.map(([k, v]) => (
        <Field key={k} name={k} value={v} />
      ))}
    </dl>
  );
}

function isShort(v: unknown): boolean {
  if (v === null || typeof v === "number" || typeof v === "boolean") return true;
  if (typeof v === "string") return v.length <= 90 && !v.includes("\n");
  if (Array.isArray(v)) return v.length === 0 || (v.length <= 8 && v.every((x) => (typeof x === "string" && x.length < 40) || typeof x === "number"));
  return false;
}

function Field({ name, value }: { name: string; value: unknown }) {
  const short = isShort(value);
  return (
    <div className={cn("grid min-w-0 gap-x-4 py-2 first:pt-0 last:pb-0", short ? "grid-cols-[minmax(96px,160px)_1fr]" : "grid-cols-1 gap-y-1.5")}>
      <dt className="truncate font-mono text-xs leading-5 text-muted-foreground">{name}</dt>
      <dd className="min-w-0">
        {short ? <ShortValue value={value} /> : <StructuredValue value={value} />}
      </dd>
    </div>
  );
}

function ShortValue({ value }: { value: unknown }) {
  if (value === null) return <span className="font-mono text-xs text-muted-foreground">null</span>;
  if (typeof value === "boolean") return <span className="font-mono text-xs text-chart-5">{String(value)}</span>;
  if (typeof value === "number") return <span className="font-mono text-xs tabular-nums">{value.toLocaleString("en-US")}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="font-mono text-xs text-muted-foreground">none</span>;
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((v, i) => (
          <span key={i} className="inline-flex h-6 items-center rounded-full bg-well px-2 font-mono text-xs">
            {String(v)}
          </span>
        ))}
      </span>
    );
  }
  return <span className="font-mono text-xs break-words">{String(value)}</span>;
}

function StringValue({ text }: { text: string }) {
  const [raw, setRaw] = useState(false);
  if (!text) return <span className="font-mono text-xs text-muted-foreground">(empty)</span>;
  const md = looksLikeMarkdown(text);
  if (md && !raw) {
    return (
      <div className="relative min-w-0">
        <button type="button" onClick={() => setRaw(true)} className="float-right ml-2 rounded-full bg-well px-2.5 py-0.5 text-xs text-muted-foreground hover:text-heading focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          Raw
        </button>
        <Markdown source={text} size="sm" />
      </div>
    );
  }
  return (
    <div className="relative min-w-0">
      {md && (
        <button type="button" onClick={() => setRaw(false)} className="float-right ml-2 rounded-full bg-well px-2.5 py-0.5 text-xs text-muted-foreground hover:text-heading focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          Rendered
        </button>
      )}
      <pre className="font-mono text-xs leading-5 break-words whitespace-pre-wrap text-foreground">{text}</pre>
    </div>
  );
}

function BlobValue({ blob }: { blob: BlobRef }) {
  const [open, setOpen] = useState(false);
  const q = useBlobText(open ? blob.$blob : undefined);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <FileText aria-hidden className="size-4 text-muted-foreground" />
        <span className="font-mono text-xs text-muted-foreground">blob {blob.$blob.slice(0, 12)} · {formatBytes(blob.size)}</span>
        <Button type="button" size="xs" variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide" : "Load"}
        </Button>
      </div>
      {!open && blob.preview && <p className="line-clamp-3 font-mono text-xs text-muted-foreground">{blob.preview}</p>}
      {open &&
        (q.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : q.error ? (
          <p className="text-[13px] text-status-danger-fg">{q.error.message}</p>
        ) : (
          <StringValue text={q.data ?? ""} />
        ))}
    </div>
  );
}
