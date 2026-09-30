"use client";

/**
 * Project intake, which becomes the po-brd run input: request (input.request), sources (seeds and
 * notes), and the advanced run options. Controlled; the page owns the value, saves it and starts
 * the run. Refs mentioned in the request are detected with po-brd's own extractRefs.
 */
import { BookOpen, ChevronDown, ChevronRight, Plus, SlidersHorizontal, Ticket } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useActorName } from "@/lib/api/actor";
import type { Intake, RunOptions } from "@/lib/delivery/types";
import { extractRefs, refKind } from "@/lib/weft/refs";
import { cn } from "@/lib/utils";
import { SourcesPicker } from "./SourcesPicker";
import { makeSource, slugify, type IntakeErrors, type IntakeFormValue } from "./sources";

/** A short example, clearly not real content (the seeded projects carry the real requests). */
export const REQUEST_PLACEHOLDER = "e.g. Remind subscribers a few days before their next reorder ships. See CP-50908 and its parent epic.";

export interface IntakeFormProps {
  value: IntakeFormValue;
  onChange: (value: IntakeFormValue) => void;
  errors?: IntakeErrors;
  mode: "create" | "edit";
  /** Edit mode: the project's slug, for the read-only output path. */
  projectId?: string;
  /** Output path to show; defaults to brd/<project-id>.md. */
  outPath?: string;
  /** Hide name and summary (the Stage 1 page shows them in the project header). */
  hideIdentity?: boolean;
  /** An existing BRD is imported instead of running po-brd (the New project page). */
  importingBrd?: boolean;
  disabled?: boolean;
  className?: string;
}

function NumberField({ label, value, min, max, onChange, disabled, hint }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void; disabled?: boolean; hint?: string }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
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
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint ?? `${min} to ${max}`}
      </p>
    </div>
  );
}

export function IntakeForm({ value, onChange, errors = {}, mode, projectId, outPath, hideIdentity, importingBrd, disabled, className }: IntakeFormProps) {
  const nameId = useId();
  const summaryId = useId();
  const requestId = useId();
  const budgetId = useId();
  const discoverId = useId();
  const [advancedOpen, setAdvancedOpen] = useState(!!errors.options);
  const [actor] = useActorName();
  const intake = value.intake;
  const setIntake = (patch: Partial<Intake>) => onChange({ ...value, intake: { ...intake, ...patch } });
  const setOptions = (patch: Partial<RunOptions>) => setIntake({ options: { ...intake.options, ...patch } });

  const detected = extractRefs(intake.request);
  const sourceValues = new Set(intake.sources.map((s) => s.value));
  const slug = projectId ?? (slugify(value.name) || "<project-id>");
  const out = outPath ?? `brd/${slug}.md`;

  return (
    <div className={cn("@container space-y-6", className)}>
      {!hideIdentity ? (
        <div className="grid gap-4 @xl:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor={nameId} className="block text-[13px] font-medium text-heading">
              Project name <span className="font-normal text-muted-foreground">required</span>
            </label>
            <Input
              id={nameId}
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              placeholder="e.g. Reorder reminders"
              className="placeholder:text-muted-foreground/60"
              disabled={disabled}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `${nameId}-err` : undefined}
            />
            {errors.name ? (
              <p id={`${nameId}-err`} className="text-xs text-destructive">
                {errors.name}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={summaryId} className="block text-[13px] font-medium text-heading">
              One-line summary <span className="font-normal text-muted-foreground">optional</span>
            </label>
            <Input id={summaryId} value={value.summary} onChange={(e) => onChange({ ...value, summary: e.target.value })} placeholder="e.g. Fewer missed reorders" className="placeholder:text-muted-foreground/60" disabled={disabled} />
          </div>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor={requestId} className="block text-[13px] font-medium text-heading">
          What should the BRD cover?
        </label>
        <Textarea
          id={requestId}
          rows={6}
          value={intake.request}
          onChange={(e) => setIntake({ request: e.target.value })}
          placeholder={REQUEST_PLACEHOLDER}
          disabled={disabled}
          aria-invalid={errors.request ? true : undefined}
          aria-describedby={`${requestId}-hint${errors.request ? ` ${requestId}-err` : ""}`}
          className="min-h-32 placeholder:text-muted-foreground/60"
        />
        <p id={`${requestId}-hint`} className="text-xs text-muted-foreground">
          {importingBrd ? "Optional with an imported BRD: kept with the project for a later po-brd run." : "What the PO wants, in their words. The agent reads it as note N1 and cites it by line."}
        </p>
        {errors.request ? (
          <p id={`${requestId}-err`} role="alert" className="text-xs text-destructive">
            {errors.request}
          </p>
        ) : null}
        {detected.length > 0 ? (
          <div className="space-y-1 pt-1">
          <div className="flex flex-wrap items-center gap-1.5" aria-label="References detected in the request">
            <span className="text-[13px] text-muted-foreground">Detected:</span>
            {detected.map((ref) => {
              const added = sourceValues.has(ref);
              const kind = refKind(ref);
              const KindIcon = kind === "confluence" ? BookOpen : Ticket;
              return (
                <span key={ref} className="inline-flex h-8 items-center gap-1 rounded-full bg-well pr-1 pl-3 font-mono text-xs text-heading" title={kind === "confluence" ? `Confluence page ${ref}` : `Jira issue ${ref}`}>
                  <KindIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="sr-only">{kind === "confluence" ? "Confluence page" : "Jira issue"}</span>
                  {ref}
                  {added ? (
                    <span className="px-2 font-sans text-xs text-muted-foreground">source</span>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="rounded-full bg-raised font-sans shadow-(--raised-shadow) hover:bg-(--chip-bg)"
                      disabled={disabled}
                      onClick={() => setIntake({ sources: [...intake.sources, makeSource(kind, ref, actor)] })}
                      aria-label={`Add ${ref} as a source`}
                    >
                      <Plus aria-hidden />
                      Add as source
                    </Button>
                  )}
                </span>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">po-brd also finds these in the request; add one as a source to have discovery fetch it first.</p>
          </div>
        ) : null}
      </div>

      <section aria-labelledby={`${requestId}-sources`} className="space-y-2">
        <h3 id={`${requestId}-sources`} className="text-[13px] font-medium text-heading">
          Requirement channels
        </h3>
        <SourcesPicker value={intake.sources} onChange={(sources) => setIntake({ sources })} disabled={disabled} />
      </section>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-[12px] bg-well px-3 text-[13px] font-medium text-heading transition-colors hover:bg-well-hover focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            {advancedOpen ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
            <SlidersHorizontal aria-hidden className="size-3.5" />
            Advanced
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <div className="space-y-5 rounded-[20px] bg-well/60 p-5">
            <div className="grid gap-4 @lg:grid-cols-3">
              <NumberField label="Max review rounds" value={intake.options.maxRounds} min={1} max={5} onChange={(n) => setOptions({ maxRounds: n })} disabled={disabled} />
              <NumberField label="Discovery rounds" value={intake.options.discoveryRounds} min={1} max={5} onChange={(n) => setOptions({ discoveryRounds: n })} disabled={disabled || !intake.options.discover} />
              <NumberField label="Searches per round" value={intake.options.maxQueries} min={1} max={10} onChange={(n) => setOptions({ maxQueries: n })} disabled={disabled || !intake.options.discover} hint="1 to 10 atl commands" />
            </div>
            <div className="flex items-center gap-2">
              <Switch id={discoverId} checked={intake.options.discover} onCheckedChange={(c) => setOptions({ discover: c })} disabled={disabled} />
              <label htmlFor={discoverId} className="text-sm text-heading">
                Search Jira & Confluence first
              </label>
            </div>
            <div className="grid gap-4 @xl:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor={budgetId} className="block text-[13px] font-medium text-heading">
                  Budget
                </label>
                <Input id={budgetId} value={intake.options.budget ?? ""} onChange={(e) => setOptions({ budget: e.target.value })} placeholder="$8" disabled={disabled} className="block w-32 font-mono" />
                <p className="text-xs text-muted-foreground">A run option, not workflow input: &quot;$8&quot;, &quot;500k&quot; or &quot;500k,$8&quot;.</p>
              </div>
              <div className="space-y-1">
                <span className="block text-[13px] font-medium text-heading">Output</span>
                <p className="flex min-h-8 items-center font-mono text-[13px] break-words text-muted-foreground">{importingBrd ? `Saves the imported BRD as ${out}` : `Writes ${out}`}</p>
                <p className="text-xs text-muted-foreground">Memory stays shared: memory/memory.md.</p>
              </div>
            </div>
            {errors.options ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.options}
              </p>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {!advancedOpen ? (
        <p className="-mt-3 font-mono text-xs break-words text-muted-foreground">
          {importingBrd ? `Saves the imported BRD as ${out}` : `Writes ${out}${mode === "edit" ? "" : " once the run starts"}`}
        </p>
      ) : null}
      {errors.form ? (
        <p role="alert" className="text-[13px] text-destructive">
          {errors.form}
        </p>
      ) : null}
    </div>
  );
}
