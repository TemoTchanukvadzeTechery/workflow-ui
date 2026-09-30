"use client";

/**
 * The bottom of every request form: what is still missing, the inline error, the "Show answer
 * JSON" disclosure (the request's weft metadata from RequestMetaContext, then the exact POST
 * body, file content abbreviated) and the buttons. Deniable kinds
 * (approve/confirm) get "Deny & stop" beside "Approve & resume"; ask/review get "Answer & resume".
 */
import { ChevronDown, ChevronRight, CircleAlert } from "lucide-react";
import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { AnswerBody } from "@/lib/weft/types";
import { cn } from "@/lib/utils";

/** The weft metadata of the request a form answers (human.requested · h4, kind, key, phase, risk), shown in the answer JSON disclosure. */
export interface RequestMeta {
  id: string;
  kind: string;
  key?: string;
  phase?: string;
  risk?: string;
}

/** Provided by HumanRequestCard, so its compact header can leave the metadata to the disclosure. */
export const RequestMetaContext = createContext<RequestMeta | null>(null);

function MetaLine({ meta }: { meta: RequestMeta }) {
  const parts: Array<[string, string]> = [["kind", meta.kind]];
  if (meta.key) parts.push(["key", meta.key]);
  if (meta.phase) parts.push(["phase", meta.phase]);
  if (meta.risk) parts.push(["risk", meta.risk]);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 font-mono text-[11.5px] leading-5 text-muted-foreground">
      <span>human.requested · {meta.id}</span>
      {parts.map(([k, v]) => (
        <span key={k} className="break-all">
          <span aria-hidden>· </span>
          {k} <span className="text-heading">{v}</span>
        </span>
      ))}
    </p>
  );
}

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
  const meta = useContext(RequestMetaContext);
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
        <div id={jsonId} className="space-y-2">
          {meta ? <MetaLine meta={meta} /> : null}
          <pre className="max-h-64 overflow-auto rounded-[16px] bg-well/70 p-3.5 font-mono text-[11.5px] leading-5 text-heading">{answerBodyPreview(requestId, answer, reviewEdit)}</pre>
        </div>
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
