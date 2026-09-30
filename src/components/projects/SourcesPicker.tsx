"use client";

/**
 * Requirement channels, in the style of Jira Product Discovery insights: typed chips grouped by
 * kind and a "+ Add source" popover with exactly four types. Jira and Confluence go to po-brd
 * `seeds`; note files and pasted notes go to `notes`. The popover is portalled but still inside
 * the stage form in the React tree, so its small forms stop their submit events from bubbling up
 * and starting the run.
 */
import { BookOpen, FileText, NotebookPen, Plus, Ticket, X, type LucideIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useActorName } from "@/lib/api/actor";
import { useWorkspaceFiles } from "@/lib/api/queries";
import type { RequirementSource, RequirementSourceKind } from "@/lib/delivery/types";
import { parseConfluenceRef, parseJiraRef } from "@/lib/weft/refs";
import { cn } from "@/lib/utils";
import { Notice } from "../hitl/bits";
import { PillChoice } from "../hitl/controls";
import { looksLikeSingleToken } from "../hitl/parse";
import { makeSource, SOURCE_GROUP_LABEL, SOURCE_KIND_LABEL } from "./sources";

export const SOURCE_ICONS: Record<RequirementSourceKind, LucideIcon> = { jira: Ticket, confluence: BookOpen, "note-file": FileText, "note-text": NotebookPen };
const KINDS: RequirementSourceKind[] = ["jira", "confluence", "note-file", "note-text"];

export interface SourcesPickerProps {
  value: RequirementSource[];
  onChange: (value: RequirementSource[]) => void;
  disabled?: boolean;
  className?: string;
  /** The document the sources feed, for the empty text ("BRD" on intake, "AAD" on Architecture). */
  docLabel?: string;
  /** The workflow the sources are sent to; defaults from docLabel (po-brd, or architect-aad for "AAD"). */
  workflow?: string;
}

/**
 * The popover's forms render inside the stage's own <form> in the React tree (portals keep React
 * ancestry), and React's submit event bubbles through it: without stopPropagation, "Add source"
 * would also submit the outer form and start the run.
 */
function ownSubmit(handler: () => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation();
    handler();
  };
}

function SourceChip({ source, onRemove, disabled }: { source: RequirementSource; onRemove: () => void; disabled?: boolean }) {
  const Icon = SOURCE_ICONS[source.kind];
  const mono = source.kind !== "note-text";
  return (
    <li className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-well pr-1 pl-3 text-[13px] text-heading" title={source.kind === "note-text" ? source.value : `${source.label} · added by ${source.addedBy.kind === "human" ? source.addedBy.name : "system"}`}>
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className={cn("truncate", mono && "font-mono")}>{source.label}</span>
      {source.kind === "confluence" && source.label !== source.value && !source.label.includes(source.value) ? <span className="font-mono text-[11px] text-muted-foreground">{source.value}</span> : null}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${SOURCE_KIND_LABEL[source.kind]} ${source.label}`}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-raised hover:text-heading focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <X aria-hidden className="size-3" />
      </button>
    </li>
  );
}

function NoteFilePicker({ onPick, taken }: { onPick: (path: string) => void; taken: Set<string> }) {
  const files = useWorkspaceFiles("notes/");
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const canUseTyped = typed.length > 0 && /\.(md|txt)$/i.test(typed) && !files.data?.some((f) => f.path === typed);
  return (
    <Command className="rounded-[16px] shadow-[0_0_0_1px_var(--rule)]" shouldFilter>
      <CommandInput placeholder="Search notes/ files" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{files.isPending ? "Loading files…" : "No matching files in notes/."}</CommandEmpty>
        {files.data && files.data.length > 0 ? (
          <CommandGroup heading="Workspace notes">
            {files.data.map((f) => (
              <CommandItem key={f.path} value={f.path} disabled={taken.has(f.path)} onSelect={() => onPick(f.path)}>
                <FileText aria-hidden />
                <span className="truncate font-mono text-xs">{f.path}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">{taken.has(f.path) ? "added" : `${Math.max(1, Math.round(f.size / 1024))} KB`}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {canUseTyped ? (
          <CommandGroup heading="Other path">
            <CommandItem value={`use:${typed}`} onSelect={() => onPick(typed)}>
              <Plus aria-hidden />
              Use <span className="font-mono text-xs">{typed}</span>
            </CommandItem>
          </CommandGroup>
        ) : null}
      </CommandList>
    </Command>
  );
}

function AddSourceForm({ onAdd, existing, workflow }: { onAdd: (kind: RequirementSourceKind, value: string, label?: string) => void; existing: RequirementSource[]; workflow: string }) {
  const [kind, setKind] = useState<RequirementSourceKind>("jira");
  const [ref, setRef] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refId = useId();
  const titleId = useId();
  const noteId = useId();
  const taken = new Set(existing.map((s) => s.value));

  const reset = () => {
    setRef("");
    setTitle("");
    setNote("");
    setError(null);
  };

  const addRef = () => {
    if (kind === "jira") {
      const key = parseJiraRef(ref);
      if (!key) return setError("Enter a Jira key such as CP-50908, or an issue URL.");
      if (taken.has(key)) return setError(`${key} is already a source.`);
      onAdd("jira", key);
    } else {
      const id = parseConfluenceRef(ref);
      if (!id) return setError("Enter a Confluence page id (digits) or a page URL containing /pages/<id> or ?pageId=<id>.");
      if (taken.has(id)) return setError(`Page ${id} is already a source.`);
      onAdd("confluence", id, title.trim() || undefined);
    }
    reset();
  };

  const single = looksLikeSingleToken(note);

  return (
    <div className="space-y-3">
      <PillChoice
        size="sm"
        value={kind}
        onChange={(k) => {
          setKind(k);
          setError(null);
        }}
        ariaLabel="Source type"
        className="flex w-full flex-wrap"
        options={KINDS.map((k) => ({ value: k, label: SOURCE_KIND_LABEL[k], icon: SOURCE_ICONS[k] }))}
      />
      {kind === "jira" || kind === "confluence" ? (
        <form className="space-y-2" onSubmit={ownSubmit(addRef)}>
          <label htmlFor={refId} className="block text-[13px] font-medium text-heading">
            {kind === "jira" ? "Issue or epic key" : "Page id or URL"}
          </label>
          <Input
            id={refId}
            autoFocus
            value={ref}
            onChange={(e) => {
              setRef(e.target.value);
              setError(null);
            }}
            placeholder={kind === "jira" ? "e.g. CP-50908" : "e.g. 48213377 or a …/pages/48213377/… URL"}
            className="font-mono text-[13px] placeholder:text-muted-foreground/60"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${refId}-err` : undefined}
          />
          {kind === "confluence" ? (
            <>
              <label htmlFor={titleId} className="block text-[13px] font-medium text-heading">
                Title <span className="font-normal text-muted-foreground">optional</span>
              </label>
              <Input id={titleId} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Notification preferences" className="placeholder:text-muted-foreground/60" aria-describedby={`${titleId}-hint`} />
              <p id={`${titleId}-hint`} className="text-xs text-muted-foreground">
                Only a label for this list; {workflow} is sent the page id and reads the page&apos;s own title.
              </p>
            </>
          ) : null}
          {error ? (
            <p id={`${refId}-err`} role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">Sent to {workflow} as a seed; discovery fetches it first.</p>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!ref.trim()}>
              Add source
            </Button>
          </div>
        </form>
      ) : kind === "note-file" ? (
        <div className="space-y-2">
          <NoteFilePicker taken={taken} onPick={(path) => onAdd("note-file", path)} />
          <p className="text-xs text-muted-foreground">A repo-relative file, sent to {workflow} in notes and cited as {workflow === "architect-aad" ? "A1, A2" : "N1, N2"}, … with line numbers.</p>
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={ownSubmit(() => {
            if (!note.trim()) return;
            onAdd("note-text", note.trim());
            reset();
          })}
        >
          <label htmlFor={noteId} className="block text-[13px] font-medium text-heading">
            Note text
          </label>
          <Textarea id={noteId} autoFocus rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Legal wants aggregate numbers only." className="placeholder:text-muted-foreground/60" />
          {single ? (
            <Notice>
              A note that is one word with no spaces is read by {workflow} as a file path, and the run fails if that file does not exist. Add more words, or use Note file for a path.
            </Notice>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant={single ? "secondary" : "default"} disabled={!note.trim()}>
              {single ? "Add anyway" : "Add note"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function SourcesPicker({ value, onChange, disabled, className, docLabel = "BRD", workflow = docLabel === "AAD" ? "architect-aad" : "po-brd" }: SourcesPickerProps) {
  const [open, setOpen] = useState(false);
  const [actor] = useActorName();
  const groups = KINDS.map((k) => ({ kind: k, items: value.filter((s) => s.kind === k) })).filter((g) => g.items.length > 0);
  const add = (kind: RequirementSourceKind, v: string, label?: string) => {
    onChange([...value, makeSource(kind, v, actor, label)]);
    if (kind === "note-file") setOpen(false);
  };
  return (
    <div className={cn("space-y-2.5", className)}>
      {groups.length === 0 ? <p className="text-sm text-muted-foreground">No sources yet. Add Jira issues, Confluence pages or notes the {docLabel} should draw on.</p> : null}
      {groups.map((g) => (
        <div key={g.kind} className="space-y-1.5">
          <div className="flex items-baseline gap-2 text-xs">
            <span className="font-medium">{SOURCE_GROUP_LABEL[g.kind]}</span>
            <span className="text-xs text-muted-foreground">{g.kind === "jira" || g.kind === "confluence" ? "searched first" : "read as notes"}</span>
          </div>
          <ul className="flex flex-wrap gap-1.5" aria-label={SOURCE_GROUP_LABEL[g.kind]}>
            {g.items.map((s) => (
              <SourceChip key={s.id} source={s} disabled={disabled} onRemove={() => onChange(value.filter((x) => x.id !== s.id))} />
            ))}
          </ul>
        </div>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="secondary" disabled={disabled}>
            Add source
            <Plus aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-4">
          <AddSourceForm existing={value} onAdd={add} workflow={workflow} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
