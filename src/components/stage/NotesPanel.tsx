"use client";

/**
 * Stage notes: anyone can add one, optionally anchored to a document section ("[BRD
 * §Requirements] …"). Architecture and implementation send them to their run as note text, so
 * a note shows which run consumed it; such a note can no longer be deleted. Read-only once the
 * stage is approved or locked, or the project is done.
 */
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAddNote, useDeleteNote } from "@/lib/api/queries";
import type { StageId, StageNote } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { actorName, TimeAgo } from "../hitl/bits";

export interface NoteAnchorOption {
  label: string;
  anchor: NonNullable<StageNote["anchor"]>;
}

export interface NotesPanelProps {
  projectId: string;
  stage: StageId;
  notes: StageNote[];
  /** Sections a note can be anchored to, e.g. BRD headings. */
  anchorOptions?: NoteAnchorOption[];
  /** Document labels by docId for the anchor chip ("BRD"); falls back to the docId. */
  docLabels?: Record<string, string>;
  readOnly?: boolean;
  className?: string;
}

/** "[BRD §Requirements] " as the prefix a note is sent with. */
export function anchorLabel(anchor: StageNote["anchor"], docLabels?: Record<string, string>): string | null {
  if (!anchor) return null;
  const doc = docLabels?.[anchor.docId] ?? anchor.docId;
  return `${doc}${anchor.section ? ` §${anchor.section}` : ""}`;
}

export function NotesPanel({ projectId, stage, notes, anchorOptions = [], docLabels, readOnly, className }: NotesPanelProps) {
  const [text, setText] = useState("");
  const [anchorIdx, setAnchorIdx] = useState<string>("none");
  const add = useAddNote(projectId);
  const del = useDeleteNote(projectId);
  const textId = useId();
  const anchorId = useId();

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    const opt = anchorIdx === "none" ? undefined : anchorOptions[Number(anchorIdx)];
    add.mutate(
      { stage, text: t, ...(opt ? { anchor: opt.anchor } : {}) },
      {
        onSuccess: () => {
          setText("");
          setAnchorIdx("none");
        },
      },
    );
  };

  const sorted = [...notes].sort((a, b) => b.at - a.at);

  return (
    <div className={cn("space-y-3", className)}>
      {!readOnly ? (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <label htmlFor={textId} className="text-xs font-medium">
            Add a note
          </label>
          <Textarea
            id={textId}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="A note for this stage; runs started here receive it as note text."
          />
          <div className="flex flex-wrap items-center gap-2">
            {anchorOptions.length > 0 ? (
              <>
                <label htmlFor={anchorId} className="sr-only">
                  Anchor to a section
                </label>
                <Select value={anchorIdx} onValueChange={setAnchorIdx}>
                  <SelectTrigger id={anchorId} size="sm" className="max-w-full min-w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No anchor</SelectItem>
                    {anchorOptions.map((o, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            ) : null}
            <span className="flex-1" />
            <Button size="sm" className="rounded-full" onClick={submit} disabled={!text.trim() || add.isPending}>
              {add.isPending ? "Adding…" : "Add note"}
            </Button>
          </div>
        </div>
      ) : null}
      {sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((note) => {
            const anchor = anchorLabel(note.anchor, docLabels);
            return (
              <li key={note.id} className="group rounded-xl border border-border p-3 text-[13px]">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    {anchor ? <span className="inline-flex h-5 items-center rounded-md bg-muted px-1.5 font-mono text-[11px] text-muted-foreground">[{anchor}]</span> : null}
                    {note.anchor?.quote ? <blockquote className="border-l-2 border-border pl-2 text-xs text-muted-foreground italic">{note.anchor.quote}</blockquote> : null}
                    <p className="break-words whitespace-pre-wrap">{note.text}</p>
                  </div>
                  {/* A note a run already received stays: deleting it would lose where the run's input came from. */}
                  {!readOnly && !note.sentToRunId ? (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Delete note"
                      className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                      disabled={del.isPending}
                      onClick={() => del.mutate(note.id)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  ) : null}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                  <span>{actorName(note.by)}</span>
                  <TimeAgo at={note.at} />
                  {note.sentToRunId ? (
                    <Link href={`/runs/${note.sentToRunId}`} className="font-mono text-primary hover:underline">
                      sent to {note.sentToRunId}
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
