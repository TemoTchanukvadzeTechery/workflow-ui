"use client";

/**
 * Waive a BRD requirement at QA (comment required). The waiver is a Decision with the actor and
 * time; the requirement then counts as covered at the Stage 4 gate and shows "Waived".
 */
import { useId, useState } from "react";
import { StatusPill } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useWaiveTrace } from "@/lib/api/queries";
import type { TraceRow } from "@/lib/delivery/types";
import { traceVerdictMeta } from "@/lib/weft/labels";

export interface WaiveDialogProps {
  projectId: string;
  row: TraceRow | null;
  onOpenChange: (open: boolean) => void;
}

export function WaiveDialog({ projectId, row, onOpenChange }: WaiveDialogProps) {
  const [comment, setComment] = useState("");
  const [touched, setTouched] = useState(false);
  const waive = useWaiveTrace(projectId);
  const id = useId();
  const errId = useId();
  const missing = !comment.trim();

  const close = (o: boolean) => {
    if (!o) {
      setComment("");
      setTouched(false);
    }
    onOpenChange(o);
  };

  const submit = () => {
    setTouched(true);
    if (!row || missing) return;
    waive.mutate({ brRef: row.brRef, body: { comment: comment.trim() } }, { onSuccess: () => close(false) });
  };

  return (
    <Dialog open={!!row} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        {row ? (
          <>
            <DialogHeader>
              <DialogTitle>Waive {row.brRef}</DialogTitle>
              <DialogDescription>The requirement counts as covered at the QA gate. Your name, the time and the reason are recorded and shown to the Product Owner at sign-off.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 rounded-[16px] bg-well px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-medium">{row.brRef}</span>
                <StatusPill {...traceVerdictMeta(row.verdict)} size="sm" />
              </div>
              <p className="text-sm leading-5 text-heading">{row.brText}</p>
            </div>
            <form
              className="space-y-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <label htmlFor={id} className="text-[13px] font-medium text-heading">
                Why is it acceptable to ship without it? <span className="font-normal text-muted-foreground">required</span>
              </label>
              <Textarea
                id={id}
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onBlur={() => setTouched(true)}
                aria-invalid={touched && missing}
                aria-describedby={touched && missing ? errId : undefined}
                placeholder="e.g. Candidate requirement parked behind Q5; Spanish headers ship in a follow-up."
              />
              {touched && missing ? (
                <p id={errId} className="text-[13px] text-status-danger-fg">
                  Add a comment explaining the waiver.
                </p>
              ) : null}
            </form>
            <DialogFooter>
              <Button variant="secondary" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={waive.isPending}>
                {waive.isPending ? "Waiving…" : `Waive ${row.brRef}`}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <DialogTitle className="sr-only">Waive requirement</DialogTitle>
        )}
      </DialogContent>
    </Dialog>
  );
}
