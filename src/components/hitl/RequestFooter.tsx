"use client";

/**
 * The bottom of every request form: what is still missing, the inline error, the "Show answer
 * JSON" disclosure (the exact POST body, file content abbreviated) and the buttons. Deniable kinds
 * (approve/confirm) get "Deny & stop" beside "Approve & resume"; ask/review get "Answer & resume".
 */
import { ChevronDown, ChevronRight, CircleAlert } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { AnswerBody } from "@/lib/weft/types";
import { cn } from "@/lib/utils";

export interface RequestFooterProps {
  requestId: string;
  answer: unknown;
  reviewEdit?: AnswerBody["reviewEdit"];
  error?: string | null;
  pending?: boolean;
  /** Reasons the primary button is disabled, shown as a hint. */
  missing?: string[];
  submitLabel?: string;
  onSubmit: () => void;
  deny?: { label?: string; onDeny: () => void };
  extra?: ReactNode;
  className?: string;
}

export function answerBodyPreview(requestId: string, answer: unknown, reviewEdit?: AnswerBody["reviewEdit"]): string {
  const body: Record<string, unknown> = { requestId, answer };
  if (reviewEdit) body.reviewEdit = { content: `<${reviewEdit.content.length.toLocaleString()} chars>`, beforeSha256: reviewEdit.beforeSha256 };
  return JSON.stringify(body, null, 2);
}

export function RequestFooter({ requestId, answer, reviewEdit, error, pending, missing = [], submitLabel = "Answer & resume", onSubmit, deny, extra, className }: RequestFooterProps) {
  const [showJson, setShowJson] = useState(false);
  const jsonId = useId();
  const blocked = missing.length > 0;
  return (
    <div className={cn("space-y-3 border-t border-rule pt-4", className)}>
      {error ? (
        <div role="alert" className="flex items-start gap-2.5 rounded-[16px] bg-status-danger-bg px-4 py-3 text-[13px] text-status-danger-fg">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      ) : null}
      {showJson ? (
        <pre id={jsonId} className="max-h-64 overflow-auto rounded-[16px] bg-well/70 p-3.5 font-mono text-[11.5px] leading-5 text-heading">
          {answerBodyPreview(requestId, answer, reviewEdit)}
        </pre>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowJson((s) => !s)}
          aria-expanded={showJson}
          aria-controls={jsonId}
          className="inline-flex h-8 items-center gap-1 rounded-[10px] px-1.5 text-[13px] text-muted-foreground hover:text-heading focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {showJson ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
          {showJson ? "Hide answer JSON" : "Show answer JSON"}
        </button>
        {extra}
        <span className="flex-1" />
        {blocked ? <span className="text-[13px] text-muted-foreground">{missing.join(" · ")}</span> : null}
        {deny ? (
          <Button type="button" variant="secondary" disabled={pending} onClick={deny.onDeny}>
            {deny.label ?? "Deny & stop"}
          </Button>
        ) : null}
        <Button type="button" disabled={pending || blocked} onClick={onSubmit}>
          {pending ? <Spinner aria-hidden /> : null}
          {pending ? "Answering…" : submitLabel}
        </Button>
      </div>
    </div>
  );
}
