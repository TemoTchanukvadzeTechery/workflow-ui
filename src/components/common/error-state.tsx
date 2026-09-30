import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  title?: string;
  /** The error; its message is shown (ApiError messages are the server's `{ error }` text). */
  error?: unknown;
  onRetry?: () => void;
  size?: "sm" | "md";
  className?: string;
}

/** Inline failure for a query or a section: what failed, the server's message, and Retry. */
export function ErrorState({ title = "Could not load this", error, onRetry, size = "md", className }: ErrorStateProps) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : undefined;
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-3 text-center", size === "sm" ? "px-4 py-6" : "px-6 py-12", className)}>
      <span className={cn("inline-flex items-center justify-center rounded-full bg-status-danger-bg text-status-danger-fg", size === "sm" ? "size-10" : "size-12")}>
        <TriangleAlert aria-hidden className={size === "sm" ? "size-4" : "size-5"} strokeWidth={1.75} />
      </span>
      <div className="flex max-w-md flex-col gap-1">
        <p className={cn("font-medium text-heading", size === "sm" ? "text-sm" : "text-[17px] leading-6 tracking-[-0.01em]")}>{title}</p>
        {message && <p className="font-mono text-xs break-words text-muted-foreground">{message}</p>}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden />
          Try again
        </Button>
      )}
    </div>
  );
}
