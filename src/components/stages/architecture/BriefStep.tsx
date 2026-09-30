"use client";

/**
 * Stage 2 · BRD & notes. The architect reads the accepted BRD (read-only), adds notes on selected
 * text or on a section ("[BRD §Requirements] …", sent to the run as note text), writes the
 * request, adds extra sources and starts architect-aad, or imports an existing AAD. Once a run
 * exists the form becomes a summary of what the run started from. The unsent request is kept per
 * project in sessionStorage, so a reload, a visit to another page or the stage locking live does
 * not lose it.
 */
import { BookOpen, ChevronDown, ChevronRight, Import, MessageSquarePlus, Play, Plus, RotateCcw, SlidersHorizontal, Ticket, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { actorText, SectionCard } from "@/components/common";
import {
  canStartAnother,
  DocVersionViewer,
  jumpToSection,
  lastReviewFeedback,
  NotAcceptedBanner,
  OptionsStrip,
  RequestText,
  ReviseNotice,
  revisionCause,
  RunHistory,
  runOutput,
  SourceChips,
  docRuns,
  stageDoc,
  type RevisionCause,
} from "@/components/doc-stage";
import { extractHeadings } from "@/components/docs";
import { Notice, TimeAgo } from "@/components/hitl";
import { ImportDocDialog, makeSource, SourcesPicker } from "@/components/projects";
import { anchorLabel, type NoteAnchorOption } from "@/components/stage";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useActorName } from "@/lib/api/actor";
import { useAddNote, useDoc, useStartArchitecture } from "@/lib/api/queries";
import { DEFAULT_AAD_OPTIONS, type DocumentArtifact, type ProjectBundle, type RequirementSource, type RunOptions, type StageNote } from "@/lib/delivery/types";
import { extractRefs, refKind } from "@/lib/weft/refs";
import type { RunDetail } from "@/lib/weft/types";

/** A short example, clearly not real content. */
export const ARCHITECT_PLACEHOLDER = "e.g. Reuse an existing site such as the customer portal, and keep the reports next to the agreement data.";

export const ARCHITECT_VALIDATION = "Provide a BRD path in brd, the architect's request in request, or at least one note.";

export interface BrdJump {
  section: string;
  item?: number;
  nonce: number;
}

export interface BriefStepProps {
  projectId: string;
  bundle: ProjectBundle;
  brd?: DocumentArtifact;
  run?: RunDetail;
  restart: boolean;
  onRestart: (on: boolean) => void;
  onStarted: () => void;
  onImported: () => void;
  readOnly?: boolean;
  jump?: BrdJump;
  onJumped?: () => void;
  anchorOptions: NoteAnchorOption[];
}

// ---------------------------------------------------------------------------------------------
// Request form
// ---------------------------------------------------------------------------------------------

interface ArchitectDraft {
  request: string;
  sources: RequirementSource[];
  options: RunOptions;
}

const draftKey = (projectId: string, restart: boolean) => `workflow-ui:architect-request:${projectId}${restart ? ":restart" : ""}`;

/** The unsent request typed on this tab, if any (storage can be missing or blocked). */
export function readArchitectDraft(projectId: string, restart = false): ArchitectDraft | undefined {
  try {
    const raw = window.sessionStorage.getItem(draftKey(projectId, restart));
    if (!raw) return undefined;
    const d = JSON.parse(raw) as Partial<ArchitectDraft>;
    if (typeof d.request !== "string" || !Array.isArray(d.sources) || !d.options || typeof d.options !== "object") return undefined;
    return { request: d.request, sources: d.sources, options: d.options };
  } catch {
    return undefined;
  }
}

function writeArchitectDraft(projectId: string, restart: boolean, draft: ArchitectDraft | undefined): void {
  try {
    if (draft) window.sessionStorage.setItem(draftKey(projectId, restart), JSON.stringify(draft));
    else window.sessionStorage.removeItem(draftKey(projectId, restart));
  } catch {
    // Private mode or blocked storage: the draft just is not kept.
  }
}

function NumberInput({ label, value, min, max, onChange, disabled, hint }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void; disabled?: boolean; hint?: string }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[13px] font-medium text-heading">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Math.trunc(Number(e.target.value)))}
        disabled={disabled}
        className="block w-28"
      />
      <p className="text-xs text-muted-foreground">{hint ?? `${min} to ${max}`}</p>
    </div>
  );
}

function optionsError(o: RunOptions): string | undefined {
  const inRange = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (!inRange(o.maxRounds, 1, 5) || !inRange(o.discoveryRounds, 1, 5) || !inRange(o.maxQueries, 1, 10)) return "Review rounds and discovery rounds are 1 to 5; searches per round are 1 to 10.";
  if (o.budget && !/^(\$\d+(\.\d+)?|\d+(\.\d+)?[km]?)(,\s*(\$\d+(\.\d+)?|\d+(\.\d+)?[km]?))?$/i.test(o.budget.trim())) return 'Budget looks like "$10", "500k" or "500k,$10".';
  return undefined;
}

function NotesToSend({ notes, docLabels }: { notes: StageNote[]; docLabels: Record<string, string> }) {
  const unsent = notes.filter((n) => !n.sentToRunId);
  return (
    <div className="space-y-1.5">
      <h4 className="text-sm font-medium text-heading">
        Architect notes <span className="font-normal text-muted-foreground">{unsent.length ? `${unsent.length} will be sent with the run as ${unsent.length === 1 ? "note A1" : `notes A1…A${unsent.length}`}` : "none yet"}</span>
      </h4>
      {unsent.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Select text in the BRD below and choose Add architect note, or add one from the Notes tab.</p>
      ) : (
        <ul className="space-y-1">
          {unsent.map((n) => {
            const anchor = anchorLabel(n.anchor, docLabels);
            return (
              <li key={n.id} className="flex min-w-0 items-start gap-2 rounded-[14px] bg-well/60 px-3 py-2 text-[13px] leading-5">
                {anchor ? <span className="token-chip h-5 shrink-0 font-mono text-[11px]">[{anchor}]</span> : null}
                <span className="min-w-0 break-words">{n.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The sources to pre-fill "Start another run" with: the saved ones plus, as notes, the last review
 * feedback, or (reopened / stale stage) the reason and the current AAD file to revise.
 */
function restartSources(base: RequirementSource[], run: RunDetail | undefined, actor: string, revision?: { cause: RevisionCause; aadPath?: string }): RequirementSource[] {
  const extra: RequirementSource[] = [];
  const fb = lastReviewFeedback(run);
  if (revision) {
    const { cause, aadPath } = revision;
    const why = cause.kind === "reopened" ? `Architecture was reopened${cause.by ? ` by ${actorText(cause.by)}` : ""}: ${cause.comment}` : cause.comment;
    extra.push(makeSource("note-text", `${why}. Revise the current AAD accordingly.`, actor, cause.kind === "reopened" ? "Reopen comment" : "Why the AAD is stale"));
    if (aadPath) extra.push(makeSource("note-file", aadPath, actor, aadPath));
  } else if (fb && run) {
    extra.push(makeSource("note-text", `Feedback from the last review of run ${run.runId} (round ${fb.round}): ${fb.feedback}`, actor, `Last review feedback (${run.runId}, round ${fb.round})`));
  }
  return [...base, ...extra.filter((x) => !base.some((s) => s.value === x.value))];
}

function ArchitectForm({ projectId, bundle, brd, run, restart, onRestart, onStarted, onImported }: BriefStepProps) {
  const record = bundle.project.stages.architecture;
  const [actor] = useActorName();
  const cause = revisionCause(record);
  const aad = stageDoc(bundle, "aad");
  const revising = restart && !!cause && !!aad;
  // Built once: the saved request (plus what a restart carries over), or this tab's unsent draft.
  const [initial] = useState<ArchitectDraft>(() => {
    const saved: ArchitectDraft = {
      request: record.request ?? "",
      sources: restart ? restartSources(record.sources ?? [], run, actor, revising && cause ? { cause, aadPath: aad?.path } : undefined) : (record.sources ?? []),
      options: { ...DEFAULT_AAD_OPTIONS, ...record.options, budget: record.options?.budget || DEFAULT_AAD_OPTIONS.budget },
    };
    return readArchitectDraft(projectId, restart) ?? saved;
  });
  const [request, setRequest] = useState(initial.request);
  const [sources, setSources] = useState<RequirementSource[]>(initial.sources);
  const [options, setOptions] = useState<RunOptions>(initial.options);
  const [restored] = useState(() => readArchitectDraft(projectId, restart) !== undefined);
  const saved = useRef(JSON.stringify({ request: record.request ?? "", sources: record.sources ?? [], options: initial.options }));
  // Keep what was typed until the run starts; nothing is stored while the form still matches the saved request.
  useEffect(() => {
    const draft = { request, sources, options };
    writeArchitectDraft(projectId, restart, !restart && JSON.stringify(draft) === saved.current ? undefined : draft);
  }, [projectId, restart, request, sources, options]);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useStartArchitecture(projectId);
  const requestId = useId();
  const discoverId = useId();
  const budgetId = useId();
  const detected = extractRefs(request);
  const known = new Set(sources.map((s) => s.value));
  const docLabels = Object.fromEntries(bundle.documents.map((d) => [d.id, d.kind.toUpperCase()]));
  const brdVersion = brd ? (brd.versions.at(-1)?.n ?? brd.versions.length) : 0;
  const set = (patch: Partial<RunOptions>) => setOptions((o) => ({ ...o, ...patch }));

  const submit = async () => {
    const optErr = optionsError(options);
    if (optErr) {
      setAdvanced(true);
      return setError(optErr);
    }
    const hasNotes = sources.some((s) => s.mapsTo === "notes") || record.notes.some((n) => !n.sentToRunId);
    if (!brd && !request.trim() && !hasNotes) return setError(ARCHITECT_VALIDATION);
    setError(null);
    try {
      await start.mutateAsync({ request: request.trim(), sources, options: { ...options, budget: options.budget?.trim() || DEFAULT_AAD_OPTIONS.budget } });
      writeArchitectDraft(projectId, restart, undefined);
      onRestart(false);
      onStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SectionCard
      density="dense"
      title={restart ? "Start another architecture run" : "Architect request"}
      description={
        <>
          {restart
            ? revising
              ? "The request as saved, with the reason and the current AAD added as notes."
              : "The request as the last run used it, with the last review feedback added as a note."
            : "What architect-aad starts from: the accepted BRD, your request, extra sources and your notes. The agent searches Jira and Confluence, then drafts the AAD for your review."}
          {restored ? " Restored from this tab: not sent until you start the run." : ""}
        </>
      }
      actions={
        restart ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              writeArchitectDraft(projectId, true, undefined);
              onRestart(false);
            }}
          >
            <X aria-hidden />
            Cancel
          </Button>
        ) : null
      }
    >
      <form
        className="@container space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-[16px] bg-well/60 px-4 py-2 font-mono text-xs text-heading">
          <span className="text-muted-foreground">brd:</span>
          {brd ? (
            <span className="min-w-0 break-words">
              {brd.path} · v{brdVersion} {brd.status === "accepted" ? "accepted" : brd.status}
            </span>
          ) : (
            <span className="text-status-attention-fg">no accepted BRD</span>
          )}
          <span className="token-chip h-5 font-sans text-[11px]">cited as B1</span>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={requestId} className="block text-[13px] font-medium text-heading">
            What should the architecture cover?
          </label>
          <Textarea id={requestId} rows={5} value={request} onChange={(e) => setRequest(e.target.value)} placeholder={ARCHITECT_PLACEHOLDER} disabled={start.isPending} className="min-h-28 placeholder:text-muted-foreground/60" />
          <p className="text-xs text-muted-foreground">What you expect from the design, in your words: systems to reuse, constraints, where it should live.</p>
          {detected.length > 0 ? (
            <div className="space-y-1 pt-1">
            <div className="flex flex-wrap items-center gap-1.5" aria-label="References detected in the request">
              <span className="text-xs text-muted-foreground">Detected:</span>
              {detected.map((ref) => (
                <span key={ref} className="inline-flex h-8 items-center gap-1 rounded-full bg-well pr-1 pl-3 font-mono text-xs text-heading" title={refKind(ref) === "confluence" ? `Confluence page ${ref}` : `Jira issue ${ref}`}>
                  {refKind(ref) === "confluence" ? <BookOpen aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : <Ticket aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
                  <span className="sr-only">{refKind(ref) === "confluence" ? "Confluence page" : "Jira issue"}</span>
                  {ref}
                  {known.has(ref) ? (
                    <span className="px-2 font-sans text-xs text-muted-foreground">source</span>
                  ) : (
                    <Button type="button" variant="ghost" size="xs" className="rounded-full bg-raised font-sans shadow-(--raised-shadow) hover:bg-(--chip-bg)" onClick={() => setSources((s) => [...s, makeSource(refKind(ref), ref, actor)])} aria-label={`Add ${ref} as a source`}>
                      <Plus aria-hidden />
                      Add as source
                    </Button>
                  )}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">architect-aad also finds these in the request; add one as a source to have discovery fetch it first.</p>
            </div>
          ) : null}
        </div>

        <section className="space-y-2" aria-label="Extra sources">
          <h4 className="text-sm font-medium text-heading">
            Extra sources <span className="font-normal text-muted-foreground">Jira and Confluence become seeds; note files and pasted notes become notes</span>
          </h4>
          <SourcesPicker value={sources} onChange={setSources} disabled={start.isPending} docLabel="AAD" />
        </section>

        <NotesToSend notes={record.notes} docLabels={docLabels} />

        <Collapsible open={advanced} onOpenChange={setAdvanced}>
          <CollapsibleTrigger asChild>
            <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-[12px] bg-well px-3 text-[13px] font-medium text-heading transition-colors hover:bg-well-hover focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
              {advanced ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
              <SlidersHorizontal aria-hidden className="size-3.5" />
              Advanced
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="space-y-5 rounded-[20px] bg-well/60 p-5">
              <div className="grid gap-4 @lg:grid-cols-3">
                <NumberInput label="Max review rounds" value={options.maxRounds} min={1} max={5} onChange={(n) => set({ maxRounds: n })} />
                <NumberInput label="Discovery rounds" value={options.discoveryRounds} min={1} max={5} onChange={(n) => set({ discoveryRounds: n })} disabled={!options.discover} />
                <NumberInput label="Searches per round" value={options.maxQueries} min={1} max={10} onChange={(n) => set({ maxQueries: n })} disabled={!options.discover} hint="1 to 10 atl commands" />
              </div>
              <div className="flex items-center gap-2">
                <Switch id={discoverId} checked={options.discover} onCheckedChange={(c) => set({ discover: c })} />
                <label htmlFor={discoverId} className="text-[13px]">
                  Search Jira & Confluence first
                </label>
              </div>
              <div className="grid gap-4 @xl:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor={budgetId} className="block text-[13px] font-medium text-heading">
                    Budget
                  </label>
                  <Input id={budgetId} value={options.budget ?? ""} onChange={(e) => set({ budget: e.target.value })} placeholder="$10" className="block w-32 font-mono" />
                  <p className="text-xs text-muted-foreground">A run option, not workflow input: &quot;$10&quot;, &quot;500k&quot; or &quot;500k,$10&quot;.</p>
                </div>
                <div className="space-y-1">
                  <span className="block text-[13px] font-medium text-heading">Output</span>
                  <p className="flex min-h-8 items-center font-mono text-[13px] break-words text-muted-foreground">Writes {bundle.project.docPaths.aad}</p>
                  <p className="text-xs text-muted-foreground">Memory stays shared: memory/memory.md.</p>
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {error ? (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-4">
          <Button type="submit" disabled={start.isPending}>
            <Play aria-hidden />
            {start.isPending ? "Starting…" : "Start architecture run"}
          </Button>
          <span className="flex-1" />
          {!restart ? (
            <ImportDocDialog
              projectId={projectId}
              stage="architecture"
              onImported={onImported}
              trigger={
                <Button type="button" variant="ghost">
                  <Import aria-hidden />
                  Import existing AAD
                </Button>
              }
            />
          ) : null}
        </div>
      </form>
    </SectionCard>
  );
}

function ArchitectSummary({ projectId, bundle, brd, run, onRestart, onImported, readOnly }: BriefStepProps) {
  const record = bundle.project.stages.architecture;
  const runs = docRuns(bundle.stages.architecture, "aad");
  const aad = stageDoc(bundle, "aad");
  const lastStatus = runs.at(-1)?.status;
  const cause = !readOnly && aad ? revisionCause(record) : undefined;
  const again = !readOnly && canStartAnother(run, { revising: !!cause, lastStatus });
  const notAccepted = runOutput(run)?.accepted === false;
  const failed = run?.status === "failed" || run?.status === "cancelled";
  const importedLast = !!record.imported && (runs.length === 0 || record.imported.at > (runs.at(-1)?.createdAt ?? 0));
  // A request typed here before the stage locked (or a run started elsewhere) is still in this tab.
  const [draft] = useState(() => (readOnly && runs.length === 0 && !record.imported ? readArchitectDraft(projectId) : undefined));
  return (
    <div className="space-y-4">
      {draft ? (
        <Notice tone="neutral" role="status">
          Your unsent architect request is kept in this tab and comes back in the form when the stage can start a run again.
        </Notice>
      ) : null}
      {notAccepted ? (
        <NotAcceptedBanner
          kind="aad"
          run={run}
          action={
            again ? (
              <Button size="sm" onClick={() => onRestart(true)}>
                <RotateCcw aria-hidden />
                Start another run
              </Button>
            ) : null
          }
        />
      ) : again && failed ? (
        <Notice tone="danger" role="status">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="min-w-0 flex-1">
              <span className="font-medium">The last architect-aad run {run?.status === "cancelled" ? "was cancelled" : "failed"}.</span> {run?.error?.message ?? (aad?.status === "accepted" ? "The accepted AAD is unchanged." : "No AAD was accepted.")}
            </p>
            <Button size="sm" onClick={() => onRestart(true)}>
              <RotateCcw aria-hidden />
              Start another run
            </Button>
          </div>
        </Notice>
      ) : null}
      {cause && again ? (
        <ReviseNotice projectId={projectId} kind="aad" cause={cause} doc={aad} onStartAnother={() => onRestart(true)} onImported={onImported} hideStart={notAccepted || failed} />
      ) : null}
      <SectionCard
        density="dense"
        title={importedLast ? "Imported AAD" : "Architect request"}
        description={importedLast ? "The AAD was imported, so no architect-aad run was needed." : "What the architecture run started from."}
      >
        <div className="space-y-4">
          {record.imported ? (
            <Notice tone="neutral" icon={Import}>
              The AAD was imported {record.imported.source === "confluence" ? `from Confluence page ${record.imported.ref}` : "as pasted markdown"} by {actorText(record.imported.by)} <TimeAgo at={record.imported.at} />
              {importedLast ? "." : ", before the architect-aad run below."}
            </Notice>
          ) : null}
          {runs.length ? (
            <>
              <div className="space-y-1.5">
                <h4 className="text-sm font-medium text-heading">Request</h4>
                <RequestText text={record.request} empty="No request text; the BRD and notes carry the ask." />
              </div>
              <div className="space-y-1.5">
                <h4 className="text-sm font-medium text-heading">Extra sources</h4>
                <SourceChips sources={record.sources} />
              </div>
              <OptionsStrip
                options={record.options}
                out={bundle.project.docPaths.aad}
                extra={null}
              />
              <p className="font-mono text-xs break-words text-muted-foreground">
                brd: {brd ? `${brd.path} · v${brd.versions.at(-1)?.n ?? brd.versions.length} ${brd.status}` : "none"}
              </p>
              <RunHistory runs={runs} workflowLabel="architect-aad" />
            </>
          ) : !record.imported ? (
            <p className="text-[13px] text-muted-foreground">No architect-aad run has started yet.</p>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// BRD with "Add architect note"
// ---------------------------------------------------------------------------------------------

interface Picked {
  quote: string;
  section?: string;
  top: number;
  left: number;
}

function sectionOf(root: HTMLElement, node: Node): string | undefined {
  const heads = Array.from(root.querySelectorAll("h2[id], h3[id]"));
  let found: string | undefined;
  for (const h of heads) {
    // The heading comes before the selection start.
    if (h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) found = (h.textContent ?? "").trim();
  }
  return found;
}

function NoteDialog({ open, onOpenChange, projectId, brd, initial, anchorOptions }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string; brd: DocumentArtifact; initial?: { quote?: string; section?: string }; anchorOptions: NoteAnchorOption[] }) {
  const add = useAddNote(projectId);
  const [text, setText] = useState("");
  const sections = anchorOptions.map((o) => o.anchor.section ?? "").filter(Boolean);
  const [section, setSection] = useState(initial?.section && sections.includes(initial.section) ? initial.section : (initial?.section ?? sections[0] ?? ""));
  const textId = useId();
  const sectionId = useId();
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    add.mutate(
      { stage: "architecture", text: t, anchor: { docId: brd.id, ...(section ? { section } : {}), ...(initial?.quote ? { quote: initial.quote } : {}) } },
      {
        onSuccess: () => {
          setText("");
          onOpenChange(false);
        },
      },
    );
  };
  const choices = section && !sections.includes(section) ? [section, ...sections] : sections;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add architect note</DialogTitle>
          <DialogDescription>Sent to the next architecture run as note text, prefixed with its anchor, e.g. [BRD §{section || "Requirements"}].</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {initial?.quote ? <blockquote className="max-h-28 overflow-y-auto border-l-2 border-primary/50 pl-3 text-[13px] text-muted-foreground italic">{initial.quote}</blockquote> : null}
          <div className="space-y-1">
            <label htmlFor={sectionId} className="text-[13px] font-medium text-heading">
              BRD section
            </label>
            <Select value={section || "none"} onValueChange={(v) => setSection(v === "none" ? "" : v)}>
              <SelectTrigger id={sectionId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Whole BRD</SelectItem>
                {choices.map((s) => (
                  <SelectItem key={s} value={s}>
                    §{s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor={textId} className="text-[13px] font-medium text-heading">
              Note
            </label>
            <Textarea id={textId} rows={4} value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder="e.g. Keep this read-only; the gateway timeout is 30 s." />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!text.trim() || add.isPending}>
              {add.isPending ? "Adding…" : "Add note"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BrdWithNotes({ projectId, brd, readOnly, jump, onJumped, anchorOptions, header }: { projectId: string; brd: DocumentArtifact; readOnly?: boolean; jump?: BrdJump; onJumped?: () => void; anchorOptions: NoteAnchorOption[]; header: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const docRoot = useRef<HTMLDivElement | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [dialog, setDialog] = useState<{ quote?: string; section?: string; n: number } | null>(null);

  // Track text selections inside the document (mouse, keyboard and touch all fire selectionchange).
  useEffect(() => {
    if (readOnly) return;
    let t: number | undefined;
    const onChange = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const root = docRoot.current;
        const box = wrap.current;
        const sel = window.getSelection();
        if (!root || !box || !sel || sel.isCollapsed || sel.rangeCount === 0) return setPicked(null);
        const range = sel.getRangeAt(0);
        if (!root.contains(range.commonAncestorContainer)) return setPicked(null);
        const quote = sel.toString().replace(/\s+/g, " ").trim();
        if (quote.length < 3) return setPicked(null);
        const r = range.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        const left = Math.min(Math.max(0, r.left - b.left), Math.max(0, b.width - 190));
        const top = Math.max(0, r.top - b.top - 40);
        setPicked({ quote: quote.length > 400 ? `${quote.slice(0, 397)}…` : quote, section: sectionOf(root, range.startContainer), top, left });
      }, 120);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("selectionchange", onChange);
    };
  }, [readOnly]);

  // A trace chip asked for a BRD section: wait until the document is rendered, then jump.
  useEffect(() => {
    if (!jump) return;
    let frame = 0;
    let tries = 0;
    const tick = () => {
      tries++;
      if (jumpToSection(docRoot.current, jump.section, jump.item) || tries > 90) {
        onJumped?.();
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [jump, onJumped]);

  return (
    <div ref={wrap} className="relative min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <div className="min-w-0 flex-1 basis-56">{header}</div>
        {!readOnly ? (
          <Button size="sm" variant="secondary" onClick={() => setDialog({ n: Date.now() })}>
            <MessageSquarePlus aria-hidden />
            Add architect note
          </Button>
        ) : null}
      </div>
      <DocVersionViewer
        projectId={projectId}
        doc={brd}
        title={brd.title}
        bodyClassName="max-h-[70vh]"
        containerRef={(el) => {
          docRoot.current = el;
        }}
      />
      {picked && !readOnly ? (
        <Button
          size="sm"
          className="absolute z-10 shadow-popover"
          style={{ top: picked.top, left: picked.left }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setDialog({ quote: picked.quote, section: picked.section, n: Date.now() });
            setPicked(null);
          }}
        >
          <MessageSquarePlus aria-hidden />
          Add architect note
        </Button>
      ) : null}
      {dialog ? <NoteDialog key={dialog.n} open onOpenChange={(o) => !o && setDialog(null)} projectId={projectId} brd={brd} initial={dialog} anchorOptions={anchorOptions} /> : null}
    </div>
  );
}

/** BRD h2 sections as note anchors ("BRD §Requirements"). */
export function useBrdAnchors(projectId: string, brd: DocumentArtifact | undefined): NoteAnchorOption[] {
  const q = useDoc(projectId, brd?.id);
  if (!brd || !q.data) return [];
  return extractHeadings(q.data.text)
    .filter((h) => h.depth === 2)
    .map((h) => ({ label: `BRD §${h.text}`, anchor: { docId: brd.id, section: h.text } }));
}

export function BriefStep(props: BriefStepProps) {
  const { projectId, bundle, brd, restart, readOnly, jump, onJumped, anchorOptions } = props;
  const record = bundle.project.stages.architecture;
  const runs = docRuns(bundle.stages.architecture, "aad");
  const started = runs.length > 0 || !!record.imported;
  const editing = !readOnly && (!started || restart);

  return (
    <div className="space-y-4">
      {editing ? <ArchitectForm key={restart ? "restart" : "first"} {...props} /> : <ArchitectSummary {...props} />}
      {brd ? (
        <section aria-label="Accepted BRD">
          <BrdWithNotes
            projectId={projectId}
            brd={brd}
            readOnly={readOnly}
            jump={jump}
            onJumped={onJumped}
            anchorOptions={anchorOptions}
            header={
              <>
                <h3 className="text-[15px] font-medium">Accepted BRD</h3>
                <p className="text-xs text-muted-foreground">
                  {brd.acceptedBy ? `Accepted by ${actorText(brd.acceptedBy)}` : "Accepted"}
                  {brd.acceptedAt ? (
                    <>
                      {" · "}
                      <TimeAgo at={brd.acceptedAt} />
                    </>
                  ) : null}
                  {!readOnly ? " · read-only here; select text to add a note on it" : ""}
                </p>
              </>
            }
          />
        </section>
      ) : (
        <Notice tone="attention">There is no accepted BRD for this project yet. Approve Requirements first.</Notice>
      )}
    </div>
  );
}
