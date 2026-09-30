"use client";

/**
 * The one loud element on the project overview: what should happen next, who it is for, and a
 * button straight to it. Done projects show who signed off instead.
 */
import { ArrowRight, BadgeCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { actorText, StageIcon } from "@/components/common";
import { splitRole } from "@/components/stage/next-action";
import { stageDef, type ProjectBundle } from "@/lib/delivery/types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export function NextStepCard({ bundle, className }: { bundle: ProjectBundle; className?: string }) {
  const { project, nextStep } = bundle;
  const base = `/projects/${encodeURIComponent(project.id)}`;
  const current = stageDef(project.currentStage);

  let kicker: string;
  let title: string;
  let body: string | undefined;
  let href: string;
  let cta: string;
  let stage = project.currentStage;

  if (project.done) {
    const d = [...project.stages.signoff.decisions].reverse().find((x) => x.decision === "approved");
    kicker = "Delivered";
    title = "Signed off and done";
    body = `${d ? `Accepted by ${actorText(d.by)}` : "Accepted"}${project.doneAt ? ` on ${formatDate(project.doneAt)}` : ""}. Every stage is approved; if something changes, reopen a stage from its page (Reopen, next to its title).`;
    href = `${base}/signoff`;
    cta = "View the sign-off";
    stage = "signoff";
  } else if (nextStep) {
    const { role, action } = splitRole(nextStep.text);
    const def = stageDef(nextStep.stage);
    kicker = `Next step${role ? ` · ${role}` : ""}`;
    title = action;
    body = `Stage ${def.n} of 5 · ${def.title}`;
    href = nextStep.href;
    cta = nextStep.href.includes("?request=") ? "Answer now" : "Open";
    stage = nextStep.stage;
  } else {
    kicker = "Next step";
    title = "Nothing is waiting on a person";
    body = `Agents are working in ${current.title}. You will be asked here and in the Inbox when a run needs input.`;
    href = `${base}/${project.currentStage}`;
    cta = `Open ${current.title}`;
  }

  // Two quiet facts under the headline: the stage metric and how much waits on people here.
  const waiting = bundle.inbox.filter((i) => i.tier !== "fyi").length;
  const metric = bundle.stages[stage]?.metric;
  const facts: Array<{ label: string; value: string }> = [];
  if (!project.done) {
    if (metric) facts.push({ label: stageDef(stage).title, value: metric });
    facts.push({ label: "Waiting on people", value: String(waiting) });
  }

  return (
    <section
      aria-label="Next step"
      className={cn(
        "relative isolate flex min-h-[200px] min-w-0 flex-col gap-4 overflow-hidden rounded-2xl p-6 text-white shadow-[0_8px_24px_-12px_rgba(27,71,219,.55)]",
        project.done ? "bg-linear-135 from-[#15803d] to-[#0f5f4a] dark:from-[#166a3a] dark:to-[#0f4a3d]" : "bg-linear-135 from-[#1b47db] via-[#2f43cf] to-[#5b3fc4] dark:from-[#2848b8] dark:via-[#3140a8] dark:to-[#4b36a0]",
        className,
      )}
    >
      {/* Decorative: the stage icon, oversized and faint, bleeding off the corner. */}
      <span aria-hidden className="pointer-events-none absolute -right-6 -bottom-8 -z-10 text-white/10">
        <StageIcon stage={stage} className="size-44" strokeWidth={1.25} />
      </span>
      <div className="flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.12em] text-white/75 uppercase">
        {project.done ? <BadgeCheck aria-hidden className="size-3.5" /> : <Sparkles aria-hidden className="size-3.5" />}
        {kicker}
      </div>
      <div className="space-y-2">
        <h2 className="text-[20px] leading-7 font-medium tracking-[-0.01em] break-words text-white">{title}</h2>
        {body ? <p className="text-[13px] leading-5 text-white/80">{body}</p> : null}
      </div>
      <div className="mt-auto flex flex-col gap-4">
      {facts.length ? (
        <dl className="grid grid-cols-2 gap-3 border-t border-white/15 pt-4">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-[10.5px] font-medium tracking-[0.12em] text-white/65 uppercase">{f.label}</dt>
              <dd className="mt-0.5 truncate text-[15px] text-white tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <Link
        href={href}
        className="inline-flex h-9 items-center gap-1.5 self-start rounded-full bg-white px-4 text-[13px] font-medium text-[#1b2f8f] shadow-sm transition-transform duration-150 hover:-translate-y-px focus-visible:ring-3 focus-visible:ring-white/60 focus-visible:outline-none"
      >
        {cta}
        <ArrowRight aria-hidden className="size-4" />
      </Link>
      </div>
    </section>
  );
}
