"use client";

/**
 * Side panel cards of the document page: facts, versions, requirements (BR list or FR traces),
 * dependencies R1..Rn, the memory update, open questions and (AAD) system changes. Rows a
 * citation chip can jump to carry refDomId(id).
 */
import { BookOpen, ChevronDown, CircleAlert, GitCompare, History, Import, PenLine, Sparkles, Ticket } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ActorLabel, IdChip, RelativeTime, SectionCard, StatusPill } from "@/components/common";
import { Markdown, type VersionLabel } from "@/components/docs";
import { parseChangeItem } from "@/components/hitl";
import { dependencyWhyText, relationText } from "@/components/projects/sources";
import type { RunIndex } from "@/components/runs/run-index-types";
import { RunChip } from "@/components/stage";
import type { Dependency, DocVersion } from "@/lib/delivery/types";
import { formatDateTime, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KIND_HINT, KIND_LABEL, SOURCE_LABEL, refDomId, type DocDetail, type OpenQuestion, type SystemChange } from "./_model";

// ---------------------------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------------------------

function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", wide && "col-span-2")}>
      <dt className="text-[10.5px] font-medium tracking-[0.12em] text-muted-foreground uppercase">{label}</dt>
      <dd className="min-w-0 text-[13px] text-foreground">{children}</dd>
    </div>
  );
}

function MonoTag({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "primary" | "attention"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 font-mono text-[11px] font-medium tabular-nums",
        tone === "primary" ? "bg-primary-soft text-primary" : tone === "attention" ? "bg-status-attention-bg text-status-attention-fg" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Shows the first `limit` items, a "Show all N" toggle for the rest. `forceOpen` reveals all. */
function ShowMore<T>({ items, limit, forceOpen, render, noun }: { items: readonly T[]; limit: number; forceOpen?: boolean; render: (item: T, i: number) => ReactNode; noun: string }) {
  const [open, setOpen] = useState(false);
  const all = open || !!forceOpen || items.length <= limit + 1;
  const shown = all ? items : items.slice(0, limit);
  return (
    <>
      {shown.map(render)}
      {items.length > limit + 1 ? (
        <li className="list-none">
          <button
            type="button"
            onClick={() => setOpen(!all)}
            aria-expanded={all}
            className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", all && "rotate-180")} />
            {all ? "Show fewer" : `Show all ${items.length} ${noun}`}
          </button>
        </li>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------------------------

export function AboutCard({ doc, current, currentLabel, total, latest }: { doc: DocDetail; current: DocVersion; currentLabel: string; total: number; latest: DocVersion }) {
  return (
    <SectionCard density="dense" title="About this document" description={KIND_HINT[doc.kind]}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
        <Fact label="Status">
          <StatusPill size="sm" status={{ kind: "doc", value: doc.status }} />
        </Fact>
        <Fact label="Kind">{KIND_LABEL[doc.kind]}</Fact>
        <Fact label="Path" wide>
          <IdChip id={doc.path} size="sm" className="max-w-full" />
        </Fact>
        <Fact label="Showing">
          <span className="font-medium">{currentLabel}</span>
          <span className="text-muted-foreground"> of {plural(total, "version")}</span>
        </Fact>
        <Fact label="Last written">
          <RelativeTime at={latest.at} />
        </Fact>
        {doc.acceptedBy ? (
          <Fact label="Accepted by">
            <ActorLabel actor={doc.acceptedBy} size="xs" />
          </Fact>
        ) : (
          <Fact label="Accepted by">
            <span className="text-muted-foreground">Not accepted yet</span>
          </Fact>
        )}
        {doc.acceptedAt ? (
          <Fact label="Accepted">
            <span title={formatDateTime(doc.acceptedAt)}>
              <RelativeTime at={doc.acceptedAt} />
            </span>
          </Fact>
        ) : null}
        {current.n !== latest.n ? (
          <Fact label="Viewing" wide>
            <span className="text-status-attention-fg">An older version. The latest is shown by default.</span>
          </Fact>
        ) : null}
      </dl>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------------------------

const SOURCE_ICON = { agent: Sparkles, "human-edit": PenLine, import: Import } as const;

export function VersionsCard({
  versions,
  labels,
  current,
  runIndex,
  onSelect,
  onCompare,
}: {
  versions: readonly DocVersion[];
  labels: readonly VersionLabel[];
  current: number;
  runIndex?: RunIndex;
  onSelect: (n: number) => void;
  onCompare: (n: number) => void;
}) {
  const newestFirst = [...versions].reverse();
  return (
    <SectionCard density="dense" title="Versions" description={`${plural(versions.length, "version")}, newest first`} bodyClassName="pt-1">
      <ol className="-mx-1.5 flex flex-col gap-1" aria-label="Document versions">
        {newestFirst.map((v, i) => {
          const label = labels.find((l) => l.n === v.n);
          const Icon = SOURCE_ICON[v.source];
          const selected = v.n === current;
          const hasPrev = i < newestFirst.length - 1;
          const run = v.runId ? runIndex?.[v.runId] : undefined;
          return (
            <li key={v.n} className={cn("relative rounded-xl px-2.5 py-2 transition-colors", selected ? "bg-primary-soft/70 ring-1 ring-primary/25" : "hover:bg-muted/60")}>
              <div className="flex items-start gap-2.5">
                <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                  <Icon aria-hidden className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <button
                      type="button"
                      onClick={() => onSelect(v.n)}
                      aria-current={selected ? "true" : undefined}
                      className="rounded text-[13px] font-medium text-foreground after:absolute after:inset-0 after:rounded-xl hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {label?.label ?? `v${v.n}`}
                      <span className="sr-only">{selected ? " (shown)" : ", show this version"}</span>
                    </button>
                    {i === 0 ? <span className="rounded-full bg-muted px-1.5 text-[10.5px] font-medium text-muted-foreground">Latest</span> : null}
                    <span className="text-xs text-muted-foreground">{SOURCE_LABEL[v.source]}</span>
                  </div>
                  {v.reason ? <p className="mt-0.5 text-xs text-muted-foreground">{v.reason}</p> : null}
                  <div className="relative z-10 mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <RelativeTime at={v.at} />
                    {v.roundKey ? <MonoTag>{v.roundKey}</MonoTag> : null}
                    {v.runId ? <RunChip runId={v.runId} workflow={run?.workflow ?? "run"} /> : null}
                    {hasPrev ? (
                      <button
                        type="button"
                        onClick={() => onCompare(v.n)}
                        className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium text-primary hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <GitCompare aria-hidden className="size-3" />
                        Diff
                        <span className="sr-only"> {label?.label ?? `v${v.n}`} against the version before it</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------------------------
// Requirements (BRD) / functional requirements (AAD)
// ---------------------------------------------------------------------------------------------

export function RequirementsCard({ doc }: { doc: DocDetail }) {
  if (doc.kind === "aad" && doc.frs?.length) {
    const untraced = doc.frs.filter((f) => f.traces.length === 0).length;
    return (
      <SectionCard
        density="dense"
        title="Functional requirements"
        description={`${plural(doc.frs.length, "FR")} traced to BRD requirements${untraced ? `, ${untraced} untraced` : ""}`}
        bodyClassName="pt-1"
      >
        <ul className="flex flex-col divide-y divide-border">
          <ShowMore
            items={doc.frs}
            limit={6}
            noun="FRs"
            render={(fr) => (
              <li key={fr.id} className="flex flex-col gap-1.5 py-2.5 first:pt-1">
                <div className="flex items-start gap-2">
                  <MonoTag tone="primary">{fr.id}</MonoTag>
                  <p className="min-w-0 flex-1 text-[13px] leading-5 text-foreground">{fr.text}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 pl-[42px] text-xs text-muted-foreground">
                  <span className="sr-only">Traces</span>
                  {fr.traces.length ? (
                    fr.traces.map((t) => <MonoTag key={t}>{t}</MonoTag>)
                  ) : (
                    <StatusPill size="sm" tone="attention" icon={CircleAlert} label="Untraced" />
                  )}
                  {fr.designElement ? <span className="min-w-0 basis-full leading-4">{fr.designElement}</span> : null}
                </div>
              </li>
            )}
          />
        </ul>
      </SectionCard>
    );
  }
  if (doc.requirements?.length) {
    const candidates = doc.requirements.filter((r) => r.candidate).length;
    return (
      <SectionCard
        density="dense"
        title="Requirements"
        description={`${plural(doc.requirements.length - candidates, "confirmed requirement")}${candidates ? `, ${candidates} candidate` : ""}`}
        bodyClassName="pt-1"
      >
        <ul className="flex flex-col divide-y divide-border">
          <ShowMore
            items={doc.requirements}
            limit={8}
            noun="requirements"
            render={(r) => (
              <li key={r.id} className="flex items-start gap-2 py-2.5 first:pt-1">
                <MonoTag tone={r.candidate ? "attention" : "primary"} className="min-w-[42px] justify-center">
                  {r.id}
                </MonoTag>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-5 text-foreground">{r.text}</p>
                  {r.candidate ? <p className="mt-0.5 text-xs text-status-attention-fg">Candidate: not confirmed by the PO yet</p> : null}
                </div>
              </li>
            )}
          />
        </ul>
      </SectionCard>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------------------------

export function DependenciesCard({ deps, reveal, kind }: { deps: readonly Dependency[]; reveal?: string; kind?: DocDetail["kind"] }) {
  if (deps.length === 0) return null;
  const jira = deps.filter((d) => d.kind === "jira").length;
  const revealHidden = !!reveal && deps.slice(6).some((d) => d.id === reveal);
  return (
    <SectionCard density="dense" title="Dependencies" description={`${jira} Jira, ${deps.length - jira} Confluence. Cited in the text as R1 to R${deps.length}.`} bodyClassName="pt-1">
      <ul className="-mx-1.5 flex flex-col gap-0.5">
        <ShowMore
          items={deps}
          limit={6}
          noun="dependencies"
          forceOpen={revealHidden}
          render={(d) => {
            const KindIcon = d.kind === "jira" ? Ticket : BookOpen;
            return (
              <li key={d.id} id={refDomId(d.id)} className="scroll-mt-20 rounded-xl px-1.5 py-2">
                <div className="flex items-start gap-2">
                  <MonoTag tone="primary" className="min-w-8 justify-center">
                    {d.id}
                  </MonoTag>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-5 font-medium text-foreground">{d.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                      <KindIcon aria-hidden className="size-3.5" />
                      <span className="sr-only">{d.kind === "jira" ? "Jira" : "Confluence"}</span>
                      <span className="font-mono text-foreground/80">{d.ref}</span>
                      <span aria-hidden>·</span>
                      <span>{relationText(d.relation)}</span>
                    </p>
                    {d.why ? (
                      <details className="group mt-1">
                        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-xs font-medium text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                          <ChevronDown aria-hidden className="size-3 transition-transform group-open:rotate-180" />
                          Why it matters
                        </summary>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{dependencyWhyText(d.relation, d.why, kind === "aad" ? "architect-aad" : "po-brd")}</p>
                      </details>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          }}
        />
      </ul>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------------------------

export function MemoryCard({ memory, isMemoryDoc }: { memory: NonNullable<DocDetail["memory"]>; isMemoryDoc: boolean }) {
  return (
    <SectionCard
      density="dense"
      title={isMemoryDoc ? "Last memory update" : "Memory update"}
      description={isMemoryDoc ? "What the latest run changed in the register." : "What the run changed in shared memory after this document was accepted."}
      bodyClassName="pt-1"
    >
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <StatusPill size="sm" status={{ kind: "memory", value: memory.status }} />
        {memory.status === "updated" ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{memory.major ? "Major update" : "Minor update"}</span> : null}
      </div>
      {memory.changes.length === 0 ? (
        <p className="rounded-lg bg-muted/50 px-3 py-3 text-center text-[13px] text-muted-foreground">No changes recorded.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          <ShowMore
            items={memory.changes}
            limit={4}
            noun="changes"
            render={(item, i) => {
              const c = parseChangeItem(item);
              return (
                <li key={i} className="flex min-w-0 flex-col gap-1 rounded-lg border border-border px-2.5 py-2">
                  {c.kind ? <span className="inline-flex h-5 w-fit items-center rounded-full bg-muted px-2 font-mono text-[11px] text-muted-foreground">{c.kind}</span> : null}
                  <div className="min-w-0 [overflow-wrap:anywhere]">
                    <Markdown source={c.summary} size="sm" className="[&_p]:my-0" />
                  </div>
                </li>
              );
            }}
          />
        </ul>
      )}
      {memory.stale.length ? (
        <div className="mt-3 rounded-lg bg-status-attention-bg px-3 py-2 text-xs text-status-attention-fg">
          <p className="font-medium">{plural(memory.stale.length, "stale register entry", "stale register entries")}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {memory.stale.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------------------------
// Open questions
// ---------------------------------------------------------------------------------------------

export function OpenQuestionsCard({ questions, reveal, onCitationClick }: { questions: readonly OpenQuestion[]; reveal?: string; onCitationClick?: (source: string, part: string) => void }) {
  if (questions.length === 0) return null;
  const revealHidden = !!reveal && questions.slice(5).some((q) => q.id === reveal);
  return (
    <SectionCard density="dense" title="Open questions" description={`${plural(questions.length, "question")} the document leaves for people to answer`} bodyClassName="pt-1">
      <ul className="-mx-1.5 flex flex-col gap-0.5">
        <ShowMore
          items={questions}
          limit={5}
          noun="questions"
          forceOpen={revealHidden}
          render={(q) => (
            <li key={q.id} id={refDomId(q.id)} className="flex scroll-mt-20 items-start gap-2 rounded-xl px-1.5 py-2">
              <MonoTag tone="attention" className="min-w-8 justify-center">
                {q.id}
              </MonoTag>
              <div className="min-w-0 flex-1">
                <Markdown source={q.text} size="sm" className="[&_p]:my-0" onCitationClick={onCitationClick} />
                {q.owner ? <p className="mt-1 text-xs text-muted-foreground">Owner: {q.owner}</p> : null}
              </div>
            </li>
          )}
        />
      </ul>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------------------------
// AAD system changes
// ---------------------------------------------------------------------------------------------

export function SystemsCard({ systems }: { systems: readonly SystemChange[] }) {
  if (systems.length === 0) return null;
  const changed = systems.filter((s) => s.changed).length;
  return (
    <SectionCard density="dense" title="System changes" description={`${changed} of ${plural(systems.length, "system")} change`} bodyClassName="pt-1">
      <ul className="flex flex-col divide-y divide-border">
        <ShowMore
          items={systems}
          limit={6}
          noun="systems"
          render={(s) => (
            <li key={s.system} className="flex flex-col gap-1 py-2.5 first:pt-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-[12.5px] font-medium text-foreground">{s.system}</span>
                <StatusPill size="sm" variant="outline" tone={s.changed ? "review" : "neutral"} icon={s.changed ? History : null} label={s.status} />
              </div>
              <p className="line-clamp-3 text-xs leading-5 text-muted-foreground" title={s.change}>
                {s.change}
              </p>
            </li>
          )}
        />
      </ul>
    </SectionCard>
  );
}
