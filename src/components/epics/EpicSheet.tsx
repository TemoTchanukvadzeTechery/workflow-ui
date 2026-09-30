"use client";

/**
 * Add or edit an epic in a side sheet: title, objective, context, in-scope list, BRD requirement
 * refs (checklist from the BRD's numbered requirements), blocked-by open questions and the parent
 * epic. In Architecture it also edits FR refs, systems and design elements.
 */
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useUpsertEpic } from "@/lib/api/queries";
import type { Epic, EpicUpsertBody } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";

export interface RefOption {
  id: string;
  text: string;
  hint?: string;
}

export interface EpicSheetProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Undefined = add a new epic. */
  epic?: Epic;
  requirements: RefOption[];
  frs?: RefOption[];
  questions?: RefOption[];
  parents: Array<{ ref: string; title: string }>;
  architecture?: boolean;
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function RefChecklist({ label, options, value, onChange, empty }: { label: string; options: RefOption[]; value: string[]; onChange: (v: string[]) => void; empty: string }) {
  const id = useId();
  const set = new Set(value);
  const unknown = value.filter((v) => !options.some((o) => o.id === v));
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium">
        {label} <span className="font-normal text-muted-foreground">{value.length} selected</span>
      </legend>
      {options.length === 0 && unknown.length === 0 ? (
        <p className="rounded-lg bg-muted/50 px-3 py-3 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1">
          {[...options, ...unknown.map((u): RefOption => ({ id: u, text: "Not in the current document" }))].map((o) => {
            const cid = `${id}-${o.id}`;
            return (
              <li key={o.id}>
                <label htmlFor={cid} className={cn("flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted", set.has(o.id) && "bg-primary-soft/60")}>
                  <Checkbox
                    id={cid}
                    checked={set.has(o.id)}
                    onCheckedChange={(c) => onChange(c === true ? [...value, o.id] : value.filter((v) => v !== o.id))}
                    className="mt-0.5"
                  />
                  <span className="w-12 shrink-0 font-mono text-[11px] leading-5 text-muted-foreground">{o.id}</span>
                  <span className="min-w-0 flex-1 text-xs leading-5">
                    <span className="line-clamp-2">{o.text}</span>
                    {o.hint ? <span className="text-muted-foreground">{o.hint}</span> : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}

function Field({ label, htmlFor, hint, children, required }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium">
        {label} {required ? <span className="font-normal text-muted-foreground">required</span> : null}
      </label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function EpicForm({ projectId, epic, requirements, frs = [], questions = [], parents, architecture, onDone }: Omit<EpicSheetProps, "open" | "onOpenChange"> & { onDone: () => void }) {
  const [title, setTitle] = useState(epic?.title ?? "");
  const [objective, setObjective] = useState(epic?.objective ?? "");
  const [context, setContext] = useState(epic?.context ?? "");
  const [inScope, setInScope] = useState((epic?.inScope ?? []).join("\n"));
  const [brRefs, setBrRefs] = useState<string[]>(epic?.brdRequirementRefs ?? []);
  const [frRefs, setFrRefs] = useState<string[]>(epic?.aadRefs ?? []);
  const [systems, setSystems] = useState((epic?.systems ?? []).join("\n"));
  const [design, setDesign] = useState((epic?.designElements ?? []).join("\n"));
  const [blockedBy, setBlockedBy] = useState<string[]>(epic?.blockedBy ?? []);
  const [parent, setParent] = useState(epic?.parentRef ?? "");
  const [error, setError] = useState<string | null>(null);
  const upsert = useUpsertEpic(projectId);
  const ids = { title: useId(), objective: useId(), context: useId(), scope: useId(), parent: useId(), systems: useId(), design: useId() };
  const parentOptions = [...parents, ...(parent && !parents.some((p) => p.ref === parent) ? [{ ref: parent, title: "Current parent" }] : [])];

  const submit = () => {
    if (!title.trim()) return setError("Give the epic a title.");
    const next: Omit<EpicUpsertBody, "id"> = {
      title: title.trim(),
      objective: objective.trim(),
      context: context.trim(),
      inScope: lines(inScope),
      brdRequirementRefs: brRefs,
      blockedBy,
      parentRef: parent,
      ...(architecture ? { aadRefs: frRefs, systems: lines(systems), designElements: lines(design) } : {}),
    };
    // Send only what changed, so the epic's history names the fields that were really edited.
    const current: Record<string, unknown> = epic ? { ...epic, blockedBy: epic.blockedBy ?? [], parentRef: epic.parentRef ?? "" } : {};
    const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => !epic || JSON.stringify(current[k]) !== JSON.stringify(v)));
    if (epic && Object.keys(changed).length === 0) return onDone();
    const body: EpicUpsertBody = { ...(epic ? { id: epic.id } : {}), ...changed };
    setError(null);
    upsert.mutate(body, { onSuccess: onDone, onError: (e) => setError(e.message) });
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        <Field label="Title" htmlFor={ids.title} required>
          <Input id={ids.title} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus aria-invalid={error && !title.trim() ? true : undefined} />
        </Field>
        <Field label="Objective" htmlFor={ids.objective} hint="One sentence: the outcome this epic delivers.">
          <Textarea id={ids.objective} rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} />
        </Field>
        <Field label="Context" htmlFor={ids.context}>
          <Textarea id={ids.context} rows={3} value={context} onChange={(e) => setContext(e.target.value)} />
        </Field>
        <Field label="In scope" htmlFor={ids.scope} hint="One item per line.">
          <Textarea id={ids.scope} rows={4} value={inScope} onChange={(e) => setInScope(e.target.value)} />
        </Field>
        <RefChecklist label="BRD requirements" options={requirements} value={brRefs} onChange={setBrRefs} empty="The BRD has no numbered requirements yet." />
        {architecture ? (
          <>
            <RefChecklist label="AAD functional requirements" options={frs} value={frRefs} onChange={setFrRefs} empty="The AAD has no functional requirements table yet." />
            <Field label="Systems" htmlFor={ids.systems} hint="One system per line, e.g. website-customer-portal.">
              <Textarea id={ids.systems} rows={3} value={systems} onChange={(e) => setSystems(e.target.value)} className="font-mono text-xs" />
            </Field>
            <Field label="Design elements" htmlFor={ids.design} hint="One per line.">
              <Textarea id={ids.design} rows={3} value={design} onChange={(e) => setDesign(e.target.value)} />
            </Field>
          </>
        ) : null}
        {questions.length > 0 || blockedBy.length > 0 ? (
          <RefChecklist label="Blocked by open questions" options={questions} value={blockedBy} onChange={setBlockedBy} empty="No open questions." />
        ) : null}
        <Field label="Parent epic in Jira" htmlFor={ids.parent} hint={parents.length ? "Epics discovered as 'parent epic' dependencies." : "No parent epic was discovered for this project."}>
          <Select value={parent || "none"} onValueChange={(v) => setParent(v === "none" ? "" : v)} disabled={parentOptions.length === 0 && !parent}>
            <SelectTrigger id={ids.parent} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No parent</SelectItem>
              {parentOptions.map((p) => (
                <SelectItem key={p.ref} value={p.ref}>
                  <span className="font-mono text-xs">{p.ref}</span>
                  <span className="ml-1.5 truncate text-muted-foreground">{p.title}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {error ? (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <SheetFooter className="flex-row justify-end border-t border-border">
        <Button type="button" variant="outline" className="rounded-full" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" className="rounded-full" disabled={upsert.isPending}>
          {upsert.isPending ? "Saving…" : epic ? "Save epic" : "Add epic"}
        </Button>
      </SheetFooter>
    </form>
  );
}

export function EpicSheet(props: EpicSheetProps) {
  const { open, onOpenChange, epic, architecture } = props;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle>{epic ? `Edit ${epic.key ?? "draft epic"}` : "Add an epic"}</SheetTitle>
          <SheetDescription>
            {epic
              ? epic.status === "draft"
                ? "Changes are kept in the epic's history. It stays a draft until the epics are accepted."
                : `Changes are kept in the epic's history.${epic.key ? " The mock does not push edits to Jira." : ""}`
              : architecture
                ? "A new epic from the architecture, e.g. per system. It is accepted with the epic updates."
                : "A new draft epic. Accept the epics once the list is right."}
          </SheetDescription>
        </SheetHeader>
        {open ? <EpicForm key={epic?.id ?? "new"} {...props} onDone={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  );
}
