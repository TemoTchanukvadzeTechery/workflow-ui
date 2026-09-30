"use client";

/**
 * QA sub-step "Final approval": the gate as a checklist. Each row is one Stage 4 rule (SPEC 4.3)
 * with its progress and the server's blocker text; warnings are ticked in the gate dialog. The
 * sticky GateFooter below carries "Certify & send to PO Review"; once approved, the banner links
 * on to PO Review.
 */
import { ArrowRight, BadgeCheck, CircleCheck, CircleSlash, ClipboardCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { actorText, HatchedBar, RelativeTime, SectionCard } from "@/components/common";
import { Button } from "@/components/ui/button";
import type { ProjectBundle, QaStep } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { docHref, readyForTestDoc } from "./ReadyForTestCard";
import { activeTasks } from "./shared";

interface Item {
  id: string;
  label: string;
  done: number;
  total: number;
  ok: boolean;
  blocker?: string;
  step?: QaStep;
  hint?: string;
}

export function FinalPanel({ projectId, bundle, onGo }: { projectId: string; bundle: ProjectBundle; onGo: (step: QaStep) => void }) {
  const view = bundle.stages.qa;
  const tasks = activeTasks(bundle);
  const trace = bundle.trace;
  const changes = bundle.changeReviews;
  const find = (re: RegExp) => view.blockers.find((b) => re.test(b));
  const certified = tasks.filter((t) => t.qa.status === "certified").length;
  const covered = trace.filter((r) => r.verdict === "met" || r.verdict === "waived").length;
  const reviewed = changes.filter((c) => c.consistent !== undefined).length;
  const inconsistent = changes.filter((c) => c.consistent === false).length;
  const hasMemory = changes.some((c) => c.kind === "memory");
  const handoff = readyForTestDoc(bundle);

  const items: Item[] = [
    { id: "tasks", label: "Every task certified by QA", done: certified, total: tasks.length, ok: certified === tasks.length && tasks.length > 0, blocker: find(/certif/i), step: "tasks" },
    { id: "trace", label: "Every requirement met or waived", done: covered, total: trace.length, ok: covered === trace.length, blocker: find(/requirement/i), step: "traceability" },
    {
      id: "changes",
      label: hasMemory ? "Every code, memory and document change reviewed" : "Every code and document change reviewed",
      done: reviewed,
      total: changes.length,
      ok: reviewed === changes.length,
      blocker: find(/change review/i),
      step: "changes",
      hint: inconsistent ? `${inconsistent} marked not consistent with the requirements` : undefined,
    },
    { id: "requests", label: "No QA request waiting on a person", done: view.pending === 0 ? 1 : 0, total: 1, ok: view.pending === 0, blocker: find(/pending request/i), step: "tasks" },
  ];
  const matched = new Set(items.map((i) => i.blocker).filter(Boolean));
  const extra = view.blockers.filter((b) => !matched.has(b));
  const approval = [...bundle.project.stages.qa.decisions].reverse().find((d) => d.decision === "approved");
  const approved = view.status === "approved";

  return (
    <div className="space-y-4">
      {approved && approval ? (
        <div className="flex flex-wrap items-start gap-3 rounded-2xl bg-status-success-bg px-4 py-3 text-status-success-fg">
          <BadgeCheck aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-[1_1_16rem] text-[13px]">
            <p className="font-medium">Certified and sent to PO Review</p>
            <p className="text-foreground/80">
              by {actorText(approval.by)} <RelativeTime at={approval.at} />
              {approval.comment ? <>: &ldquo;{approval.comment}&rdquo;</> : null}
            </p>
          </div>
          <Button asChild size="sm" className="rounded-full">
            <Link href={`/projects/${encodeURIComponent(projectId)}/signoff`}>
              Open PO Review
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      ) : null}
      <SectionCard density="dense" kicker="Stage 4 gate" title="Certify & send to PO Review" description="QA certifies once every rule below holds. The Product Owner then reviews the delivery and signs off.">
        <ul className="divide-y">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
              <span className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full", i.ok ? "bg-status-success-bg text-status-success-fg" : "bg-status-danger-bg text-status-danger-fg")}>
                {i.ok ? <CircleCheck aria-hidden className="size-4" /> : <CircleSlash aria-hidden className="size-4" />}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-[13px] font-medium">
                  {i.label} <span className="sr-only">{i.ok ? "(done)" : "(blocking)"}</span>
                </p>
                {i.id !== "requests" ? <HatchedBar done={i.done} total={i.total} size="sm" tone={i.ok ? "success" : "running"} label={`${i.done} of ${i.total}`} className="max-w-72" /> : null}
                <p className={cn("text-xs", i.ok ? "text-muted-foreground" : "text-foreground")}>
                  {i.ok ? (i.id === "requests" ? "Nothing is waiting." : `${i.done}/${i.total} done`) : (i.blocker ?? `${i.done}/${i.total} done`)}
                </p>
                {i.hint ? <p className="text-xs text-status-danger-fg">{i.hint}</p> : null}
              </div>
              {!i.ok && i.step && !approved ? (
                <Button type="button" variant="outline" size="sm" className="h-7 rounded-full" onClick={() => onGo(i.step!)}>
                  Resolve
                  <ArrowRight aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
          {extra.map((b) => (
            <li key={b} className="flex items-center gap-3 py-3 text-[13px]">
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-status-danger-bg text-status-danger-fg">
                <CircleSlash aria-hidden className="size-4" />
              </span>
              {b}
            </li>
          ))}
        </ul>
        {handoff ? (
          <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
            <ClipboardCheck aria-hidden className="size-3.5" />
            QA tested against the developer&rsquo;s hand-off:
            <Link href={docHref(projectId, handoff.id)} className="font-medium text-primary hover:underline">
              Ready for test note
            </Link>
          </p>
        ) : null}
      </SectionCard>
      {view.warnings.length > 0 ? (
        <SectionCard density="dense" title="Warnings to acknowledge" description="They do not block certification, but you tick each one in the approval dialog, and they are recorded with your decision.">
          <ul className="space-y-1.5">
            {view.warnings.map((w) => (
              <li key={w} className="flex items-start gap-2 rounded-lg bg-status-attention-bg px-3 py-2 text-[13px]">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-status-attention-fg" />
                {w}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </div>
  );
}
