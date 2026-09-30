"use client";

/**
 * The PO Review summary cards (brief C.5): the "ready for your sign-off" and done banners,
 * headline numbers, the original request, requirement verdicts, epic delivery, recording
 * highlights, QA history (loop-backs and re-tests), open questions and the decisions log.
 */
import { BadgeCheck, Bug, CircleHelp, ClipboardCheck, FileText, Film, Layers, ListChecks, MessageSquareQuote, RotateCcw, ShieldOff, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ActorLabel, actorText, EmptyState, HatchedBar, IdChip, KpiTile, RelativeTime, SectionCard, StatusPill } from "@/components/common";
import { RecordingPlayer } from "@/components/evidence/RecordingPlayer";
import { Button } from "@/components/ui/button";
import { stageDef, type Actor, type ProjectBundle, type RequirementSource } from "@/lib/delivery/types";
import { formatDate, formatDateTime, plural } from "@/lib/format";
import { decisionMeta, qaStatusMeta, traceVerdictMeta } from "@/lib/weft/labels";
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
    <div role="status" className="flex items-start gap-3 rounded-2xl bg-primary-soft px-4 py-3">
      <ClipboardCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
      <div className="min-w-0 space-y-1">
        <p className="text-[15px] font-medium">Ready for your sign-off</p>
        <p className="text-[13px] text-foreground/80">
          {certified ? (
            <>
              QA certified the delivery ({actorText(certified.by)}, <RelativeTime at={certified.at} />).{" "}
            </>
          ) : null}
          Check the requirements, the evidence and the open questions below, then <span className="font-medium text-foreground">Sign off &amp; mark done</span>, or{" "}
          <span className="font-medium text-foreground">Send back</span> to QA or Implementation with a comment.
        </p>
        <nav aria-label="Jump to a section" className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5 text-xs">
          {links.map((l) => (
            <a key={l.id} href={`#${l.id}`} className="font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
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
  return (
    <div role="status" className="flex items-start gap-3 rounded-2xl bg-status-success-bg px-4 py-3 text-status-success-fg">
      <BadgeCheck aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 space-y-0.5">
        <p className="text-[15px] font-medium">
          Done · accepted by {s?.name ?? "the Product Owner"} on {formatDate(s?.at ?? bundle.project.doneAt ?? bundle.project.updatedAt)}
        </p>
        {s?.comment ? <p className="text-[13px] text-foreground/80">&ldquo;{s.comment}&rdquo;</p> : null}
        <p className="text-xs text-foreground/70">This project is read-only. The summary below is the record of what was delivered.</p>
      </div>
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
    <div className="grid grid-cols-2 gap-3 @3xl/stage:grid-cols-4">
      <KpiTile size="md" label="Requirements met" value={`${met}/${rows.length}`} hint={waived ? `${waived} waived with a comment` : rows.length ? "Every requirement traced" : "No requirements traced"} />
      <KpiTile size="md" label="Tasks certified" value={`${certified}/${tasks.length}`} hint={`across ${plural(epics.length, "epic")}${loopHint}`} />
      <KpiTile size="md" label="Evidence items" value={live.length} hint={`${plural(recordings, "recording")}`} />
      <KpiTile size="md" label="Agent cost" value={`$${bundle.spendUsd.toFixed(2)}`} hint="all runs, all stages" />
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
    <SectionCard density="dense" kicker="Where it started" title="The original request" description={<span>Asked by {p.createdBy.kind === "human" ? p.createdBy.name : "system"} on {formatDate(p.createdAt)}</span>}>
      <blockquote className="flex gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-[14px] leading-relaxed">
        <MessageSquareQuote aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 break-words">{p.intake.request || p.summary || "No request text was recorded."}</span>
      </blockquote>
      {sources.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          <div className="kicker">Sources</div>
          <ul className="flex flex-wrap gap-1.5">
            {sources.map((s) => (
              <li key={s.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs" title={s.value}>
                <span className="text-muted-foreground">{SOURCE_KIND[s.kind]}</span>
                {s.kind === "jira" || s.kind === "confluence" ? <span className="font-mono">{s.value}</span> : null}
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
      kicker="BRD"
      title="Requirements"
      description="Each requirement with its verdict from the QA trace matrix."
      actions={
        <Button asChild variant="ghost" size="sm" className="rounded-full text-xs">
          <Link href={qaHref(projectId, "traceability")}>Trace matrix</Link>
        </Button>
      }
    >
      {reqs.length === 0 ? (
        <EmptyState size="sm" icon={FileText} title="No requirements" body="The BRD has no numbered requirements to trace." />
      ) : (
        <ul className="divide-y divide-border">
          {reqs.map((r) => {
            const row = byRef.get(r.id);
            return (
              <li key={r.id} className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-3">
                <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground sm:pt-0.5">{r.id}</span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-[13px] leading-snug">
                    {r.text}
                    {r.candidate ? <span className="ml-1.5 rounded-full bg-muted px-1.5 py-px text-[11px] text-muted-foreground">Candidate</span> : null}
                  </p>
                  {row?.waiver ? (
                    <p className="flex items-start gap-1 text-xs text-muted-foreground">
                      <ShieldOff aria-hidden className="mt-0.5 size-3 shrink-0" />
                      <span>
                        Waived by {row.waiver.by.kind === "human" ? row.waiver.by.name : "system"}
                        {row.waiver.comment ? `: "${row.waiver.comment}"` : ""}
                      </span>
                    </p>
                  ) : row ? (
                    <p className="text-xs text-muted-foreground tabular-nums">
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
    <SectionCard density="dense" kicker="Delivery" title="Epics" description="Certified tasks per epic.">
      {epics.length === 0 ? (
        <EmptyState size="sm" icon={Layers} title="No epics" body="No epics were proposed for this project." />
      ) : (
        <ul className="space-y-3">
          {epics.map((e) => {
            const tasks = tasksOfEpic(bundle, e);
            const certified = tasks.filter((t) => t.qa.status === "certified").length;
            const inQa = tasks.filter((t) => t.qa.status === "testing" || t.qa.status === "in_review").length;
            return (
              <li key={e.id} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {e.key ? <IdChip id={e.key} size="sm" copy={false} /> : <span className="font-mono text-xs text-muted-foreground">{e.id}</span>}
                  <span className="min-w-0 flex-1 text-[13px] font-medium">{e.title}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{tasks.length ? `${certified}/${tasks.length} certified` : "No delivery tasks"}</span>
                </div>
                {tasks.length ? <HatchedBar done={certified} partial={inQa} total={tasks.length} size="sm" label={`${e.title}: ${certified} of ${tasks.length} tasks certified`} /> : <div className="h-1.5 rounded-full bg-foreground/[0.05]" aria-hidden />}
                {e.brdRequirementRefs.length ? (
                  <div className="flex flex-wrap gap-1">
                    {e.brdRequirementRefs.map((ref) => (
                      <Link key={ref} href={qaHref(projectId, "traceability")} className="rounded-full bg-muted px-1.5 py-px font-mono text-[11px] text-muted-foreground hover:text-foreground">
                        {ref}
                      </Link>
                    ))}
                  </div>
                ) : null}
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
      kicker="Evidence highlights"
      title="Recordings"
      description="One QA recording per epic. Click a marker to jump to that moment."
      actions={
        <Button asChild variant="ghost" size="sm" className="rounded-full text-xs">
          <Link href={qaHref(projectId, "tasks")}>All evidence</Link>
        </Button>
      }
    >
      {items.length === 0 ? (
        <EmptyState size="sm" icon={Film} title="No recordings" body="QA attached no recordings to this project's tasks." />
      ) : (
        <ul className="grid gap-4 @3xl/stage:grid-cols-2">
          {items.map(({ epic, rec }) => (
            <li key={epic.id} className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                <span className="font-medium">{epic.title}</span>
                <Link href={`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(rec!.task.id)}`} className="font-mono text-xs text-muted-foreground hover:text-foreground">
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
    <SectionCard density="dense" kicker="Verification" title="QA history" description="Tasks that needed more than one QA pass. Every other task passed QA on its first run.">
      <ul className="divide-y divide-border">
        {entries.map((e) => {
          const review = e.task.qa.status === "certified" ? e.task.qa.review : undefined;
          return (
            <li key={e.task.id} className="space-y-1.5 py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                <Link href={taskHref(projectId, e.task.id)} className="font-mono text-xs font-medium text-primary hover:underline sm:pt-0.5">
                  {e.task.jiraKey ?? e.task.id}
                </Link>
                <span className="min-w-0 flex-1 text-[13px] leading-snug">{e.task.title}</span>
                <StatusPill {...qaStatusMeta(e.task.qa.status)} size="sm" label={e.loopedBack && e.task.qa.status === "certified" ? "Re-certified" : qaStatusMeta(e.task.qa.status).label} />
              </div>
              <p className="text-xs text-muted-foreground">
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
                    <li key={i} className="flex items-start gap-1.5 text-xs leading-snug">
                      <Bug aria-hidden className="mt-0.5 size-3 shrink-0 text-status-danger-fg" />
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
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="kicker">
          {label} · {items.length}
        </span>
        {docId ? (
          <Link href={docHref(projectId, docId)} className="text-xs text-muted-foreground hover:text-foreground">
            Open {label}
          </Link>
        ) : null}
      </div>
      <ul className="space-y-1.5">
        {shown.map((q) => (
          <li key={q.key} className="flex gap-2 text-[13px] leading-snug">
            <span className="w-7 shrink-0 font-mono text-xs text-muted-foreground">{q.id}</span>
            <span className="min-w-0 flex-1">
              {q.text}
              {q.owner ? <span className="text-muted-foreground"> · {q.owner}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {items.length > QUESTIONS_SHOWN ? (
        <Button variant="ghost" size="sm" className="-ml-2 h-7 rounded-full text-xs" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
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
      kicker="Still open"
      title="Open questions"
      description={total ? `${plural(total, "item")} left open in the accepted documents${total > QUESTIONS_SHOWN ? `; the first ${QUESTIONS_SHOWN} of each document are shown` : ""}.` : "Nothing was left open."}
    >
      {total === 0 ? (
        <EmptyState size="sm" icon={CircleHelp} title="No open questions" body="The accepted BRD and AAD list no open questions." />
      ) : (
        <div className="space-y-4">
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
  const head =
    e.kind === "decision" ? (
      <>
        <StatusPill {...decisionMeta(e.decision)} label={e.stage === "signoff" && e.decision === "approved" ? "Signed off" : decisionMeta(e.decision).label} />
        <span className="text-[13px] font-medium">
          Stage {stageDef(e.stage).n} · {stageDef(e.stage).title}
        </span>
      </>
    ) : e.kind === "reopened" ? (
      <>
        <StatusPill tone="attention" icon={e.fromStage === "signoff" ? Undo2 : RotateCcw} label={e.fromStage === "signoff" ? "Sent back" : "Reopened"} />
        <span className="text-[13px] font-medium">
          to Stage {stageDef(e.stage).n} · {stageDef(e.stage).title}
          {e.fromStage !== e.stage ? <span className="font-normal text-muted-foreground"> from {stageDef(e.fromStage).title}</span> : null}
        </span>
      </>
    ) : (
      <>
        <StatusPill tone="neutral" icon={ShieldOff} label="Waived" />
        <span className="min-w-0 text-[13px] font-medium">
          <span className="font-mono">{e.brRef}</span> <span className="font-normal text-muted-foreground">{e.brText}</span>
        </span>
      </>
    );
  return (
    <li className="relative pb-4 pl-5 last:pb-0">
      <span aria-hidden className="absolute top-[7px] -left-[4px] size-[7px] rounded-full bg-muted-foreground/50 ring-2 ring-card" />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">{head}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <Who actor={e.by} />
        <span title={formatDateTime(e.at)}>{formatDateTime(e.at)}</span>
        <RelativeTime at={e.at} className="hidden sm:inline" />
      </div>
      {e.comment ? <p className="mt-1 text-[13px] leading-snug text-foreground/85">&ldquo;{e.comment}&rdquo;</p> : null}
      {e.kind === "decision" && e.acknowledged?.length ? (
        <p className="mt-1 text-xs text-muted-foreground">Acknowledged: {e.acknowledged.join("; ")}</p>
      ) : null}
    </li>
  );
}

export function DecisionsLog({ bundle }: { bundle: ProjectBundle }) {
  const all = decisionsLog(bundle);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? all : all.slice(0, 8);
  return (
    <SectionCard density="dense" kicker="Audit trail" title="Decisions log" description="Every gate decision, send-back and waiver, newest first.">
      {all.length === 0 ? (
        <EmptyState size="sm" icon={ListChecks} title="No decisions yet" body="Stage approvals, send-backs and waivers will be listed here." />
      ) : (
        <>
          <ol className="ml-1 border-l border-border">
            {shown.map((e) => (
              <LogRow key={e.id} e={e} />
            ))}
          </ol>
          {all.length > shown.length || showAll ? (
            <Button variant="ghost" size="sm" className="mt-2 rounded-full text-xs" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${all.length}`}
            </Button>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
