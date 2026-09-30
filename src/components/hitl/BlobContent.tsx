"use client";

/**
 * Review subjects and attachments, fetched by blob ref and rendered by media type: markdown
 * inline, text/x-diff and "+ / - " text as a diff, JSON pretty-printed, anything else as text.
 */
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBlobText } from "@/lib/api/queries";
import type { BlobRef } from "@/lib/weft/types";
import { cn } from "@/lib/utils";
import { Markdown } from "../docs/Markdown";
import { TextDiff } from "../docs/TextDiff";

export interface BlobItem {
  label: string;
  ref: BlobRef;
  mediaType?: string;
}

function looksLikeLineDiff(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  return lines.length > 0 && lines.every((l) => /^[+-] /.test(l) || l === "+" || l === "-");
}

export function renderText(text: string, mediaType: string | undefined, opts: { size?: "base" | "sm" } = {}): ReactNode {
  const type = (mediaType ?? "").split(";")[0]?.trim() ?? "";
  if (type === "text/markdown") return <Markdown source={text} size={opts.size ?? "sm"} />;
  if (type === "text/x-diff" || type === "text/x-patch") return <TextDiff diffText={text} maxHeightClass="max-h-[60vh]" />;
  if (type === "application/json") {
    let pretty = text;
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // not JSON after all: show it as text
    }
    return <pre className="max-h-[50vh] overflow-auto rounded-[16px] bg-well/60 p-4 font-mono text-xs leading-5 text-heading">{pretty}</pre>;
  }
  if (text.trim() === "(no change)" || looksLikeLineDiff(text)) return <TextDiff diffText={text} maxHeightClass="max-h-[60vh]" />;
  return <pre className="max-h-[50vh] overflow-auto rounded-[16px] bg-well/60 p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-heading">{text}</pre>;
}

/** Loads a blob and hands its text to `children` (or renders it by media type). */
export function BlobContent({ blobRef, mediaType, children, className }: { blobRef: BlobRef | string | undefined; mediaType?: string; children?: (text: string) => ReactNode; className?: string }) {
  const hash = typeof blobRef === "string" ? blobRef : blobRef?.$blob;
  const q = useBlobText(hash);
  if (!hash) return null;
  if (q.isPending) {
    return (
      <div className={cn("space-y-2", className)} aria-busy="true">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <p role="alert" className={cn("text-[13px] text-destructive", className)}>
        Could not load this attachment: {q.error.message}
      </p>
    );
  }
  return <div className={cn("min-w-0", className)}>{children ? children(q.data) : renderText(q.data, mediaType)}</div>;
}

/** Several blobs as tabs (label + size). */
export function AttachmentTabs({ items, className, render }: { items: BlobItem[]; className?: string; render?: Record<string, (text: string) => ReactNode> }) {
  if (items.length === 0) return null;
  if (items.length === 1) {
    const only = items[0]!;
    return (
      <div className={cn("space-y-2", className)}>
        <p className="text-[13px] font-medium text-heading">
          {only.label} <span className="font-mono text-xs font-normal text-muted-foreground">· {only.ref.size.toLocaleString()} bytes</span>
        </p>
        <BlobContent blobRef={only.ref} mediaType={only.mediaType}>
          {render?.[only.label.toLowerCase()]}
        </BlobContent>
      </div>
    );
  }
  return (
    <Tabs defaultValue="a0" className={cn("min-w-0 gap-3", className)}>
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <TabsList className="justify-start">
          {items.map((item, i) => (
            <TabsTrigger key={i} value={`a${i}`} className="h-9 flex-none px-3.5 capitalize">
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {items.map((item, i) => (
        <TabsContent key={i} value={`a${i}`} className="min-w-0">
          <BlobContent blobRef={item.ref} mediaType={item.mediaType}>
            {render?.[item.label.toLowerCase()]}
          </BlobContent>
        </TabsContent>
      ))}
    </Tabs>
  );
}
