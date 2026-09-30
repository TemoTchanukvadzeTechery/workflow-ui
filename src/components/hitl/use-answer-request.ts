"use client";

/**
 * Posting an answer. Validation errors ("answer does not match the request schema: …",
 * "<path> changed since this review opened") stay inline next to the button; when the request is
 * already gone ("request h3 is already answered", "… was superseded", "no pending request h3")
 * the card toasts, refetches and lets the list drop it.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { qk } from "@/lib/api/keys";
import { useAnswer } from "@/lib/api/queries";
import type { AnswerBody, RunDetail } from "@/lib/weft/types";

const GONE = /already answered|was superseded|no pending request|is already (complete|failed|cancelled)/i;

/** weft's "request h3 is already answered" etc. in words, without the internal ids. */
function goneText(message: string): string {
  if (/already answered/i.test(message)) return "This request was already answered";
  if (/superseded/i.test(message)) return "A newer request replaced this one";
  if (/is already (complete|failed|cancelled)/i.test(message)) return "The run already ended";
  return "This request is no longer open";
}

export function useAnswerRequest({ runId, requestId, projectId, onAnswered }: { runId: string; requestId: string; projectId?: string; onAnswered?: () => void }) {
  const qc = useQueryClient();
  const mutation = useAnswer(projectId);
  const [error, setError] = useState<string | null>(null);

  const refetch = () => {
    void qc.invalidateQueries({ queryKey: ["weft"] });
    void qc.invalidateQueries({ queryKey: ["inbox"] });
    if (projectId) void qc.invalidateQueries({ queryKey: ["project", projectId] });
  };

  const submit = (answer: unknown, reviewEdit?: AnswerBody["reviewEdit"]) => {
    setError(null);
    const body: AnswerBody = { requestId, answer, ...(reviewEdit ? { reviewEdit } : {}) };
    mutation.mutate(
      { runId, body },
      {
        onSuccess: () => {
          const workflow = qc.getQueryData<RunDetail>(qk.run(runId))?.workflow;
          toast.success(`Answer sent; ${workflow ?? "the run"} resumed`);
          onAnswered?.();
        },
        onError: (e) => {
          if (GONE.test(e.message)) {
            toast.info(goneText(e.message), { description: "Refreshing the request list." });
            refetch();
            onAnswered?.();
          } else {
            setError(e.message);
          }
        },
      },
    );
  };

  return { submit, pending: mutation.isPending, error, clearError: () => setError(null) };
}
