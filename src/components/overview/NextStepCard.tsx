"use client";

/**
 * The one loud element on the project overview, built like the reference's Insights card: a
 * grained mesh gradient with a glass chip ("Next step · Developer"), a big white numeral (what
 * waits on people here), the action and a white button straight to it. Done projects show who
 * signed off instead.
 */
import { ArrowRight, BadgeCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { actorText } from "@/components/common";
import { splitRole } from "@/components/stage/next-action";
import { MeshBackdrop } from "@/components/viz";
import { stageDef, type ProjectBundle } from "@/lib/delivery/types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export function NextStepCard({ bundle, className }: { bundle: ProjectBundle; className?: string }) {
  const { project, nextStep } = bundle;
  const base = `/projects/${encodeURIComponent(project.id)}`;
  const current = stageDef(project.currentStage);
  const waiting = bundle.inbox.filter((i) => i.tier !== "fyi").length;

  let chip: string;
  let title: string;
  let body: string | undefined;
  let href: string;
  let cta: string;
  let stage = project.currentStage;
  let numeral: string;
  let numeralLabel: string;

  if (project.done) {
    const d = [...project.stages.signoff.decisions].reverse().find((x) => x.decision === "approved");
    chip = "Delivered";
    title = "Signed off and done";
    body = `${d ? `Accepted by ${actorText(d.by)}` : "Accepted"}${project.doneAt ? ` on ${formatDate(project.doneAt)}` : ""}. If something changes, reopen a stage from its page (Reopen, next to its title).`;
    href = `${base}/signoff`;
    cta = "View the sign-off";
    stage = "signoff";
    numeral = "5/5";
    numeralLabel = "stages approved";
  } else if (nextStep) {
    const { role, action } = splitRole(nextStep.text);
    const def = stageDef(nextStep.stage);
    chip = `Next step${role ? ` · ${role}` : ""}`;
    title = action;
    body = `Stage ${def.n} of 5 · ${def.title}`;
    href = nextStep.href;
    cta = nextStep.href.includes("?request=") ? "Answer now" : "Open";
    stage = nextStep.stage;
    numeral = String(waiting);
    numeralLabel = waiting === 1 ? "item waits on a person here" : "items wait on people here";
  } else {
    chip = "Next step";
    title = "Nothing is waiting on a person";
    body = `Agents are working in ${current.title}. You will be asked here and in the Inbox when a run needs input.`;
    href = `${base}/${project.currentStage}`;
    cta = `Open ${current.title}`;
    numeral = String(waiting);
    numeralLabel = "items wait on people here";
  }

  const metric = project.done ? undefined : bundle.stages[stage]?.metric;

  return (
    <section
      aria-label="Next step"
      className={cn("relative isolate flex min-h-[340px] overflow-hidden text-white min-w-0 flex-col gap-5 rounded-[28px] p-6 shadow-[0_16px_36px_-18px_rgba(20,40,120,.45)] sm:p-7", className)}
    >
      {/* The Insights card's backdrop (mesh, glass, scrim under the text, grain, dark dimmer). */}
      <MeshBackdrop />
      <span className="inline-flex h-8 w-fit items-center gap-1.5 rounded-full border border-white/50 bg-white/25 px-3 text-[13px] leading-none text-[#2F2A2A] shadow-[inset_0_1px_0_rgba(255,255,255,.5)] backdrop-blur-md dark:border-white/25 dark:bg-white/10 dark:text-white dark:shadow-[inset_0_1px_0_rgba(255,255,255,.18)]">
        {project.done ? <BadgeCheck aria-hidden className="size-3.5" strokeWidth={1.75} /> : <Sparkles aria-hidden className="size-3.5" strokeWidth={1.75} />}
        {chip}
      </span>

      <div data-mesh-text className="mt-auto flex flex-col gap-4">
        <div>
          <div className="text-[56px] leading-none font-normal tracking-[-0.045em] tabular-nums [text-shadow:0_2px_24px_rgba(10,20,70,.25)] sm:text-[64px]">{numeral}</div>
          <p className="mt-2 text-[15px] leading-5 text-white/90">{numeralLabel}</p>
        </div>
        <div className="space-y-1.5 border-t border-white/20 pt-4">
          <h2 className="text-[18px] leading-6 font-medium tracking-[-0.01em] text-balance break-words text-white">{title}</h2>
          {body ? (
            <p className="text-sm leading-5 text-white/85">
              {body}
              {metric ? ` · ${metric}` : ""}
            </p>
          ) : null}
        </div>
        <Link
          href={href}
          className="inline-flex h-10 items-center gap-2 self-start rounded-[14px] bg-white px-4.5 text-sm font-medium text-[#0B0B0B] shadow-[0_6px_16px_-6px_rgba(10,20,70,.45)] transition-transform duration-150 hover:-translate-y-px focus-visible:ring-3 focus-visible:ring-white/70 focus-visible:outline-none"
        >
          {cta}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </section>
  );
}
