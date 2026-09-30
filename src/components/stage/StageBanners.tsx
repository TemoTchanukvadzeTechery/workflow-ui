"use client";

/**
 * Stage-level notices and the reopen flow: StaleBanner (an earlier stage was reopened after this
 * one progressed), LockedStage (the previous stage is not approved yet) and ReopenDialog (take
 * back an approval; later stages turn stale and lock until it is re-approved).
 */
import { History, Lock } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useReopenStage } from "@/lib/api/queries";
import { STAGES, stageDef, type StageId } from "@/lib/delivery/types";
import { Notice, TimeAgo } from "../hitl/bits";

/** `approvedBefore`: the stage had an approval that the reopen took away, so it is approved "again". */
export function StaleBanner({ stale, approvedBefore = true, className }: { stale: { since: number; reason: string }; approvedBefore?: boolean; className?: string }) {
  return (
    <Notice tone="attention" icon={History} className={className} role="status">
      <span className="font-medium">Stale.</span> {stale.reason} <TimeAgo at={stale.since} prefix="(" suffix=")" className="text-xs opacity-80" /> Review what changed, then approve this stage{approvedBefore ? " again" : ""}.
    </Notice>
  );
}

export function LockedStage({ stage, className, children }: { stage: StageId; className?: string; children?: ReactNode }) {
  const def = stageDef(stage);
  const prev = STAGES.find((s) => s.n === def.n - 1);
  return (
    <div className={className}>
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
        <span className="inline-flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Lock aria-hidden className="size-4" />
        </span>
        <p className="text-[15px] font-medium">Unlocks when {prev ? prev.title : "the previous stage"} is approved</p>
        <p className="max-w-md text-[13px] text-muted-foreground">
          {def.title} starts once {prev ? `Stage ${prev.n}, ${prev.title},` : "the previous stage"} passes its gate. Anything already here stays and is shown read-only.
        </p>
        {children}
      </div>
    </div>
  );
}

export interface ReopenDialogProps {
  projectId: string;
  stage: StageId;
  /** Defaults to an outline "Reopen" button. */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onReopened?: () => void;
}

export function ReopenDialog({ projectId, stage, trigger, open, onOpenChange, onReopened }: ReopenDialogProps) {
  const def = stageDef(stage);
  const later = STAGES.filter((s) => s.n > def.n);
  const [innerOpen, setInnerOpen] = useState(false);
  const isOpen = open ?? innerOpen;
  const setOpen = (o: boolean) => {
    setInnerOpen(o);
    onOpenChange?.(o);
  };
  const [comment, setComment] = useState("");
  const commentId = useId();
  const reopen = useReopenStage(projectId);
  const submit = () => {
    if (!comment.trim()) return;
    reopen.mutate(
      { stage, body: { comment: comment.trim() } },
      {
        onSuccess: () => {
          setComment("");
          setOpen(false);
          onReopened?.();
        },
      },
    );
  };
  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger !== null ? (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant="outline" size="sm" className="rounded-full">
              <History aria-hidden />
              Reopen
            </Button>
          )}
        </DialogTrigger>
      ) : null}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reopen {def.title}?</DialogTitle>
          <DialogDescription>
            The stage loses its approval and becomes the current stage again.
            {later.length > 0 ? ` ${later.map((s) => s.title).join(", ")} keep their data but are marked stale and locked until ${def.title} is approved again.` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label htmlFor={commentId} className="text-xs font-medium">
            Why are you reopening it? <span className="font-normal text-muted-foreground">required</span>
          </label>
          <Textarea id={commentId} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Legal changed the retention rule; the BRD needs a new requirement." />
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button className="rounded-full" onClick={submit} disabled={!comment.trim() || reopen.isPending}>
            {reopen.isPending ? "Reopening…" : `Reopen ${def.title}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
