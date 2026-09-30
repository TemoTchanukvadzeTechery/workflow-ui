"use client";

/**
 * The PO Review summary cards (brief C.5): the "ready for your sign-off" and done banners,
 * headline numbers, the original request, requirement verdicts, epic delivery, recording
 * highlights, QA history (loop-backs and re-tests), open questions and the decisions log.
 */
import { BadgeCheck, Bug, CircleHelp, ClipboardCheck, FileText, Film, Layers, ListChecks, MessageSquareQuote, RotateCcw, ShieldOff, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ActorLabel, actorText, EmptyState, HatchedBar, IdChip, KpiTile, RelativeTime, SectionCard, StatusPill, toneClasses } from "@/components/common";
import { RecordingPlayer } from "@/components/evidence/RecordingPlayer";
import { Button } from "@/components/ui/button";
import { stageDef, type Actor, type ProjectBundle, type RequirementSource } from "@/lib/delivery/types";
import { formatDate, formatDateTime, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { decisionMeta, qaStatusMeta, traceVerdictMeta, type Tone } from "@/lib/weft/labels";
import { acceptedDoc, decisionsLog, decisionsNeededOf, epicRecording, openQuestionsOf, qaHistory, signedOffBy, tasksOfEpic, type LogEntry, type OpenQuestion, type QaHistoryEntry } from "./model";

const docHref = (projectId: string, docId: string) => `/projects/${encodeURIComponent(projectId)}/docs/${encodeURIComponent(docId)}`;
const qaHref = (projectId: string, step: string) => `/projects/${encodeURIComponent(projectId)}/qa?step=${step}`;
const taskHref = (projectId: string, taskId: string) => `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`;

/** Section ids the "ready for your sign-off" banner links to. */
export const SIGNOFF_ANCHORS = { requirements: "signoff-requirements", evidence: "signoff-evidence", questions: "signoff-questions" } as const;

// ---------------------------------------------------------------------------------------------
// Ready for sign-off banner (before the decision)
// ---------------------------------------------------------------------------------------------

export function ReadyBanner({ bundle }: { bundle: ProjectBundle }) {
  const certified = [...bundle.project.stages.qa.decisions].reverse().find((d) => d.decision === "approved");
  const links = [
    { id: SIGNOFF_ANCHORS.requirements, label: "Requirements" },
    { id: SIGNOFF_ANCHORS.evidence, label: "Evidence" },
    { id: SIGNOFF_ANCHORS.questions, label: "Open questions" },
  ];
  return (
    <div role="status" className="card-surface flex items-start gap-4 rounded-[20px] px-5 py-4 sm:px-6 sm:py-5">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-status-running-bg text-status-running-fg">
        <ClipboardCheck aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 space-y-2">
        <p className="text-[20px] leading-7 font-medium tracking-[-0.015em] text-heading">Ready for your sign-off</p>
        <p className="max-w-3xl text-sm leading-5 text-muted-foreground">
          {certified ? (
            <>
              QA certified the delivery ({actorText(certified.by)}, <RelativeTime at={certified.at} />).{" "}
            </>
          ) : null}
          Check the requirements, the evidence and the open questions below, then <span className="font-medium text-heading">Sign off &amp; mark done</span>, or{" "}
          <span className="font-medium text-heading">Send back</span> to QA or Implementation with a comment.
        </p>
        <nav aria-label="Jump to a section" className="flex flex-wrap gap-1.5 pt-1">
          {links.map((l) => (
            <a key={l.id} href={`#${l.id}`} className="inline-flex h-8 items-center rounded-[12px] bg-well px-3 text-[13px] text-heading transition-colors hover:bg-well-hover focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Done banner
// ---------------------------------------------------------------------------------------------

export function DoneBanner({ bundle }: { bundle: ProjectBundle }) {
  const s = signedOffBy(bundle);
  const at = s?.at ?? bundle.project.doneAt ?? bundle.project.updatedAt;
  return (
    <div role="status" className="card-surface relative overflow-hidden rounded-2xl px-5 py-5 sm:px-7 sm:py-6">
      {/* A soft green glow behind the check, the page's one celebratory touch. */}
      <span aria-hidden className="pointer-events-none absolute -top-24 -left-16 size-72 rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--status-success-solid)_16%,transparent),transparent)]" />
      <div className="relative flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-status-success-bg text-status-success-fg shadow-[0_8px_20px_-10px_color-mix(in_srgb,var(--status-success-solid)_60%,transparent)]">
          <BadgeCheck aria-hidden className="size-6" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-[32px] leading-none font-normal tracking-[-0.03em] text-heading sm:text-[36px]">Done</span>
            <StatusPill tone="success" icon={BadgeCheck} label="Signed off" variant="chip" />
          </p>
          <p className="text-[15px] text-muted-foreground">
            Accepted by <span className="text-heading">{s?.name ?? "the Product Owner"}</span> on {formatDate(at)}
          </p>
        </div>
      </div>
      {s?.comment ? <p className="relative mt-4 max-w-3xl rounded-[16px] bg-well px-4 py-3 text-[15px] leading-6 text-heading">&ldquo;{s.comment}&rdquo;</p> : null}
      <p className="relative mt-3 text-[13px] text-muted-foreground">This project is read-only. The summary below is the record of what was delivered.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Headline numbers
// ---------------------------------------------------------------------------------------------

export function SummaryKpis({ bundle }: { bundle: ProjectBundle }) {
  const rows = bundle.trace;
  const met = rows.filter((r) => r.verdict === "met").length;
  const waived = rows.filter((r) => r.verdict === "waived").length;
  const tasks = bundle.tasks.filter((t) => t.status !== "cancelled");
  const certified = tasks.filter((t) => t.qa.status === "certified").length;
  const live = bundle.evidence.filter((e) => !e.supersededBy);
  const recordings = live.filter((e) => e.kind === "video").length;
  const epics = bundle.epics.filter((e) => e.status !== "draft");
  // Certified only after QA sent them back once: the PO should know the first pass failed.
  const loops = qaHistory(bundle).filter((h) => h.loopedBack && h.task.qa.status === "certified");
  const loopBugs = loops.reduce((n, h) => n + h.bugs.length, 0);
  const loopHint = loops.length ? ` · ${loops.length} after a QA loop-back${loopBugs ? ` (${plural(loopBugs, "bug")})` : ""}` : "";
  return (
    <div className="grid grid-cols-2 gap-3 @3xl/stage:grid-cols-4 @3xl/stage:gap-4">
      <KpiTile label="Requirements met" value={`${met}/${rows.length}`} hint={waived ? `${waived} waived with a comment` : rows.length ? "Every requirement traced" : "No requirements traced"} />
      <KpiTile label="Tasks certified" value={`${certified}/${tasks.length}`} hint={`across ${plural(epics.length, "epic")}${loopHint}`} />
      <KpiTile label="Evidence items" value={live.length} hint={`${plural(recordings, "recording")}`} />
      <KpiTile label="Agent cost" value={`$${bundle.spendUsd.toFixed(2)}`} hint="all runs, all stages" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The original request
// ---------------------------------------------------------------------------------------------

const SOURCE_KIND: Record<RequirementSource["kind"], string> = { jira: "Jira", confluence: "Confluence", "note-file": "Note file", "note-text": "Note" };

export function OriginalRequest({ bundle }: { bundle: ProjectBundle }) {
  const p = bundle.project;
  const sources = p.intake.sources;
  return (
    <SectionCard density="dense" title="The original request" description={<span>Where it started: asked by {p.createdBy.kind === "human" ? p.createdBy.name : "system"} on {formatDate(p.createdAt)}</span>}>
      <blockquote className="flex gap-3 rounded-[16px] bg-well px-4 py-3.5 text-[15px] leading-6 text-heading">
        <MessageSquareQuote aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 break-words">{p.intake.request || p.summary || "No request text was recorded."}</span>
      </blockquote>
      {sources.length > 0 ? (
        <div className="mt-4 space-y-2">
          <div className="text-[13px] text-muted-foreground">Sources</div>
          <ul className="flex flex-wrap gap-1.5">
            {sources.map((s) => (
              <li key={s.id} className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full px-3 text-[13px] text-heading shadow-[inset_0_0_0_1px_var(--circle-border)]" title={s.value}>
                <span className="text-muted-foreground">{SOURCE_KIND[s.kind]}</span>
                {s.kind === "jira" || s.kind === "confluence" ? <span className="font-mono text-xs">{s.value}</span> : null}
                <span className="truncate">{s.kind === "jira" || s.kind === "confluence" ? (s.label !== s.value ? s.label : "") : s.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------------------------
// Requirements with their verdicts
// ---------------------------------------------------------------------------------------------

export function RequirementVerdicts({ projectId, bundle }: { projectId: string; bundle: ProjectBundle }) {
  const brd = acceptedDoc(bundle, "brd");
  const byRef = new Map(bundle.trace.map((r) => [r.brRef, r]));
  const reqs = brd?.requirements?.length ? brd.requirements : bundle.trace.map((r) => ({ id: r.brRef, text: r.brText, candidate: false }));
  return (
    <SectionCard
      id={SIGNOFF_ANCHORS.requirements}
      className="scroll-mt-20"
      density="dense"
      title="Requirements"
      description="Each BRD requirement with its verdict from the QA trace matrix."
      actions={
        <Button asChild variant="secondary" size="sm">
          <Link href={qaHref(projectId, "traceability")}>Trace matrix</Link>
        </Button>
      }
    >
      {reqs.length === 0 ? (
        <EmptyState size="sm" icon={FileText} title="No requirements" body="The BRD has no numbered requirements to trace." />
      ) : (
        <ul className="-mx-5 divide-y divide-rule border-t border-rule">
          {reqs.map((r) => {
            const row = byRef.get(r.id);
            return (
              <li key={r.id} className="flex flex-col gap-1.5 px-5 py-3.5 transition-colors hover:bg-foreground/[0.02] sm:flex-row sm:items-start sm:gap-3">
                <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground sm:pt-0.5">{r.id}</span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm leading-5 text-heading">
                    {r.text}
                    {r.candidate ? <span className="ml-1.5 rounded-full bg-well px-2 py-px text-xs text-muted-foreground">Candidate</span> : null}
                  </p>
                  {row?.waiver ? (
                    <p className="flex items-start gap-1 text-[13px] text-muted-foreground">
                      <ShieldOff aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        Waived by {row.waiver.by.kind === "human" ? row.waiver.by.name : "system"}
                        {row.waiver.comment ? `: "${row.waiver.comment}"` : ""}
                      </span>
                    </p>
                  ) : row ? (
                    <p className="text-[13px] text-muted-foreground tabular-nums">
                      {plural(row.taskIds.length, "task")} · {plural(row.acIds.length, "acceptance criterion", "acceptance criteria")} · {plural(row.evidenceCount, "evidence item")}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0">{row ? <StatusPill {...traceVerdictMeta(row.verdict)} /> : <StatusPill tone="neutral" label="Not traced" icon={CircleHelp} />}</div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------------------------
// Epics with delivery progress
// ---------------------------------------------------------------------------------------------

export function EpicsProgress({ projectId, bundle }: { projectId: string; bundle: ProjectBundle }) {
  const epics = bundle.epics;
  return (
    <SectionCard density="dense" title="Epics" description="Delivery: certified tasks per epic.">
      {epics.length === 0 ? (
        <EmptyState size="sm" icon={Layers} title="No epics" body="No epics were proposed for this project." />
      ) : (
        <ul className="divide-y divide-rule">
          {epics.map((e) => {
            const tasks = tasksOfEpic(bundle, e);
            const certified = tasks.filter((t) => t.qa.status === "certified").length;
            const inQa = tasks.filter((t) => t.qa.status === "testing" || t.qa.status === "in_review").length;
            return (
              <li key={e.id} className="space-y-2.5 py-4 first:pt-1 last:pb-0">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="min-w-0 flex-1 text-[15px] leading-6 text-muted-foreground">{e.title}</span>
                  <span className="text-[15px] text-heading tabular-nums">{tasks.length ? `${certified}/${tasks.length}` : "-"}</span>
                </div>
                {tasks.length ? (
                  <HatchedBar done={certified} partial={inQa} total={tasks.length} size="lg" label={`${e.title}: ${certified} of ${tasks.length} tasks certified`} />
                ) : (
                  <div className="bar-track h-3.5 rounded-full" aria-hidden />
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  {e.key ? <IdChip id={e.key} size="sm" copy={false} /> : <span className="font-mono text-xs text-muted-foreground">{e.id}</span>}
                  <span className="text-[13px] text-muted-foreground">{tasks.length ? `${certified} of ${plural(tasks.length, "task")} certified` : "No delivery tasks"}</span>
                  {e.brdRequirementRefs.map((ref) => (
                    <Link key={ref} href={qaHref(projectId, "traceability")} className="inline-flex h-6 items-center rounded-full bg-well px-2 font-mono text-[11px] text-muted-foreground hover:text-heading">
                      {ref}
                    </Link>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------------------------
// Evidence highlights: one recording per epic
// ---------------------------------------------------------------------------------------------

export function EvidenceHighlights({ projectId, bundle }: { projectId: string; bundle: ProjectBundle }) {
  const items = bundle.epics.map((e) => ({ epic: e, rec: epicRecording(bundle, e) })).filter((x) => x.rec);
  return (
    <SectionCard
      id={SIGNOFF_ANCHORS.evidence}
      className="scroll-mt-20"
      density="dense"
      title="Recordings"
      description="Evidence highlights: one QA recording per epic. Click a marker to jump to that moment."
      actions={
        <Button asChild variant="secondary" size="sm">
          <Link href={qaHref(projectId, "tasks")}>All evidence</Link>
        </Button>
      }
    >
      {items.length === 0 ? (
        <EmptyState size="sm" icon={Film} title="No recordings" body="QA attached no recordings to this project's tasks." />
      ) : (
        <ul className="grid gap-4 @3xl/stage:grid-cols-2 @5xl/stage:grid-cols-3">
          {items.map(({ epic, rec }) => (
            <li key={epic.id} className="min-w-0 space-y-2.5">
              {/* One line (the full title on hover), so the players of a row line up. */}
              <div className="flex min-w-0 items-baseline gap-x-2 text-sm">
                <span className="min-w-0 truncate font-medium text-heading" title={epic.title}>
                  {epic.title}
                </span>
                <Link href={`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(rec!.task.id)}`} className="shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground">
                  {rec!.task.jiraKey ?? rec!.task.id}
                </Link>
              </div>
              <RecordingPlayer item={rec!.video} taskLabel={rec!.task.jiraKey ?? rec!.task.id} compact />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------------------------
// QA history: loop-backs and re-tests
// ---------------------------------------------------------------------------------------------

function historyLine(e: QaHistoryEntry): string {
  const runs = `${plural(e.devRuns, "implementation run")} · ${plural(e.qaRuns, "QA run")}`;
  if (!e.loopedBack) return `Re-tested · ${runs}`;
  const found = e.bugs.length ? `QA found ${plural(e.bugs.length, "bug")}` : "QA found bugs";
  return `${found} and sent it back to implementation · ${runs}`;
}

export function QaHistory({ projectId, bundle }: { projectId: string; bundle: ProjectBundle }) {
  const entries = qaHistory(bundle);
  if (entries.length === 0) return null;
  return (
    <SectionCard density="dense" title="QA history" description="Tasks that needed more than one QA pass. Every other task passed QA on its first run.">
      <ul className="divide-y divide-rule">
        {entries.map((e) => {
          const review = e.task.qa.status === "certified" ? e.task.qa.review : undefined;
          return (
            <li key={e.task.id} className="space-y-1.5 py-3.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                <Link href={taskHref(projectId, e.task.id)} className="font-mono text-xs font-medium text-primary hover:underline sm:pt-0.5">
                  {e.task.jiraKey ?? e.task.id}
                </Link>
                <span className="min-w-0 flex-1 text-sm leading-5 text-heading">{e.task.title}</span>
                <StatusPill {...qaStatusMeta(e.task.qa.status)} size="sm" label={e.loopedBack && e.task.qa.status === "certified" ? "Re-certified" : qaStatusMeta(e.task.qa.status).label} />
              </div>
              <p className="text-[13px] text-muted-foreground">
                {historyLine(e)}
                {review ? (
                  <>
                    {" "}
                    · certified by {actorText(review.by)} <RelativeTime at={review.at} />
                  </>
                ) : null}
              </p>
              {e.bugs.length ? (
                <ul className="space-y-0.5">
                  {e.bugs.map((b, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[13px] leading-5">
                      <Bug aria-hidden className="mt-0.5 size-3.5 shrink-0 text-status-danger-fg" />
                      <span className="min-w-0">{b}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------------------------
// Open questions left in the BRD and AAD
// ---------------------------------------------------------------------------------------------

/** Items shown per document before "Show all". */
const QUESTIONS_SHOWN = 3;

function QuestionGroup({ projectId, kind, docId, questions, decisions }: { projectId: string; kind: "brd" | "aad"; docId?: string; questions: OpenQuestion[]; decisions: string[] }) {
  const [showAll, setShowAll] = useState(false);
  const label = kind.toUpperCase();
  const items = [...questions.map((q) => ({ key: q.id, id: q.id, text: q.text, owner: q.owner })), ...decisions.map((d, i) => ({ key: `d${i}`, id: "Dec.", text: d, owner: undefined }))];
  const shown = showAll ? items : items.slice(0, QUESTIONS_SHOWN);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[13px] font-medium text-heading">
          {label}
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-well px-1.5 text-xs font-normal text-muted-foreground tabular-nums">{items.length}</span>
        </span>
        {docId ? (
          <Link href={docHref(projectId, docId)} className="text-[13px] text-primary hover:underline">
            Open {label}
          </Link>
        ) : null}
      </div>
      <ul className="space-y-1.5">
        {shown.map((q) => (
          <li key={q.key} className="flex gap-2 text-sm leading-5">
            <span className="w-7 shrink-0 font-mono text-xs text-muted-foreground">{q.id}</span>
            <span className="min-w-0 flex-1">
              {q.text}
              {q.owner ? <span className="text-muted-foreground"> · {q.owner}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {items.length > QUESTIONS_SHOWN ? (
        <Button variant="ghost" size="sm" className="-ml-3" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${items.length} ${label} items`}
        </Button>
      ) : null}
    </div>
  );
}

export function OpenQuestions({ projectId, bundle }: { projectId: string; bundle: ProjectBundle }) {
  const groups = (["brd", "aad"] as const).map((kind) => {
    const doc = acceptedDoc(bundle, kind);
    return { kind, doc, questions: openQuestionsOf(doc), decisions: kind === "aad" ? decisionsNeededOf(doc) : [] };
  });
  const total = groups.reduce((n, g) => n + g.questions.length + g.decisions.length, 0);
  return (
    <SectionCard
      id={SIGNOFF_ANCHORS.questions}
      className="scroll-mt-20"
      density="dense"
      title="Open questions"
      description={total ? `${plural(total, "item")} left open in the accepted documents${total > QUESTIONS_SHOWN ? `; the first ${QUESTIONS_SHOWN} of each document are shown` : ""}.` : "Nothing was left open."}
    >
      {total === 0 ? (
        <EmptyState size="sm" icon={CircleHelp} title="No open questions" body="The accepted BRD and AAD list no open questions." />
      ) : (
        <div className="space-y-5">
          {groups
            .filter((g) => g.questions.length || g.decisions.length)
            .map((g) => (
              <QuestionGroup key={g.kind} projectId={projectId} kind={g.kind} docId={g.doc?.id} questions={g.questions} decisions={g.decisions} />
            ))}
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------------------------
// Decisions log
// ---------------------------------------------------------------------------------------------

function Who({ actor }: { actor: Actor }) {
  return <ActorLabel actor={actor} size="xs" />;
}

function LogRow({ e }: { e: LogEntry }) {
  const tone: Tone = e.kind === "decision" ? decisionMeta(e.decision).tone : e.kind === "reopened" ? "attention" : "neutral";
  const head =
    e.kind === "decision" ? (
      <>
        <StatusPill {...decisionMeta(e.decision)} label={e.stage === "signoff" && e.decision === "approved" ? "Signed off" : decisionMeta(e.decision).label} />
        <span className="text-sm font-medium text-heading">
          Stage {stageDef(e.stage).n} · {stageDef(e.stage).title}
        </span>
      </>
    ) : e.kind === "reopened" ? (
      <>
        <StatusPill tone="attention" icon={e.fromStage === "signoff" ? Undo2 : RotateCcw} label={e.fromStage === "signoff" ? "Sent back" : "Reopened"} />
        <span className="text-sm font-medium text-heading">
          to Stage {stageDef(e.stage).n} · {stageDef(e.stage).title}
          {e.fromStage !== e.stage ? <span className="font-normal text-muted-foreground"> from {stageDef(e.fromStage).title}</span> : null}
        </span>
      </>
    ) : (
      <>
        <StatusPill tone="neutral" icon={ShieldOff} label="Waived" />
        <span className="min-w-0 text-sm font-medium text-heading">
          <span className="font-mono">{e.brRef}</span> <span className="font-normal text-muted-foreground">{e.brText}</span>
        </span>
      </>
    );
  return (
    <li className="relative pb-5 pl-6 last:pb-0">
      <span aria-hidden className={cn("absolute top-[9px] -left-[5.5px] size-[10px] rounded-full ring-4 ring-card", toneClasses(tone).solid)} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">{head}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted-foreground">
        <Who actor={e.by} />
        <span title={formatDateTime(e.at)}>{formatDateTime(e.at)}</span>
        <RelativeTime at={e.at} className="hidden sm:inline" />
      </div>
      {e.comment ? <p className="mt-1.5 text-sm leading-5 text-heading">&ldquo;{e.comment}&rdquo;</p> : null}
      {e.kind === "decision" && e.acknowledged?.length ? (
        <p className="mt-1 text-[13px] text-muted-foreground">Acknowledged: {e.acknowledged.join("; ")}</p>
      ) : null}
    </li>
  );
}

export function DecisionsLog({ bundle }: { bundle: ProjectBundle }) {
  const all = decisionsLog(bundle);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? all : all.slice(0, 8);
  return (
    <SectionCard density="dense" title="Decisions log" description="The audit trail: every gate decision, send-back and waiver, newest first.">
      {all.length === 0 ? (
        <EmptyState size="sm" icon={ListChecks} title="No decisions yet" body="Stage approvals, send-backs and waivers will be listed here." />
      ) : (
        <>
          <ol className="ml-1.5 border-l-2 border-rule pt-0.5">
            {shown.map((e) => (
              <LogRow key={e.id} e={e} />
            ))}
          </ol>
          {all.length > shown.length || showAll ? (
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${all.length}`}
            </Button>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
