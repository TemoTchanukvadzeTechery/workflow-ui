"use client";

/**
 * Import an existing BRD or AAD instead of running its workflow: paste markdown, or a Confluence
 * page id/URL the mock "fetches". With projectId it posts to the stage's import endpoint; without
 * one (the New project page) it hands the ImportBody to onSubmit. It is often rendered inside a
 * stage <form> (the dialog is portalled, but React events still bubble through that form), so it
 * has no <form> of its own and its buttons are type="button".
 */
import { BookOpen, ClipboardPaste, Import } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useImportDoc } from "@/lib/api/queries";
import type { ImportBody, ProjectBundle } from "@/lib/delivery/types";
import { parseConfluenceRef } from "@/lib/weft/refs";
import { Markdown } from "../docs/Markdown";
import { Notice } from "../hitl/bits";

export interface ImportDocDialogProps {
  projectId?: string;
  stage: "requirements" | "architecture";
  onImported?: (bundle: ProjectBundle) => void;
  onSubmit?: (body: ImportBody) => void;
  /** Defaults to an outline "Import existing BRD/AAD" button; pass null for a controlled dialog. */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function firstHeading(markdown: string): string | undefined {
  const m = /^#\s+(.+)$/m.exec(markdown);
  return m?.[1]?.replace(/^(BRD:|Architecture Approach\s*-)\s*/i, "").trim() || undefined;
}

export function ImportDocDialog({ projectId, stage, onImported, onSubmit, trigger, open, onOpenChange }: ImportDocDialogProps) {
  const doc = stage === "requirements" ? "BRD" : "AAD";
  const [innerOpen, setInnerOpen] = useState(false);
  const isOpen = open ?? innerOpen;
  const setOpen = (o: boolean) => {
    setInnerOpen(o);
    onOpenChange?.(o);
  };
  const [tab, setTab] = useState<"paste" | "confluence">("paste");
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState(false);
  const [ref, setRef] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const importDoc = useImportDoc(projectId ?? "");
  const contentId = useId();
  const refId = useId();
  const titleId = useId();

  const pageId = parseConfluenceRef(ref);
  const heading = firstHeading(content);
  const expected = stage === "requirements" ? /^#\s+BRD:/m : /^#\s+Architecture Approach/m;
  const unusual = content.trim() !== "" && !expected.test(content);

  const reset = () => {
    setContent("");
    setRef("");
    setTitle("");
    setError(null);
    setPreview(false);
  };

  const submit = () => {
    let body: ImportBody;
    if (tab === "paste") {
      if (!content.trim()) return setError(`Paste the ${doc} markdown.`);
      body = { content, source: "paste", ...(title.trim() || heading ? { title: title.trim() || heading } : {}) };
    } else {
      if (!pageId) return setError("Enter a Confluence page id (digits) or a page URL containing /pages/<id> or ?pageId=<id>.");
      // The mock server fetches the page content from the id.
      body = { content: "", source: "confluence", ref: pageId, ...(title.trim() ? { title: title.trim() } : {}) };
    }
    setError(null);
    if (!projectId) {
      onSubmit?.(body);
      reset();
      setOpen(false);
      return;
    }
    importDoc.mutate(
      { stage, body },
      {
        onSuccess: (bundle) => {
          onImported?.(bundle);
          reset();
          setOpen(false);
        },
        onError: (e) => setError(e.message),
      },
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger !== null ? (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button type="button" variant="outline" size="sm" className="rounded-full">
              <Import aria-hidden />
              Import existing {doc}
            </Button>
          )}
        </DialogTrigger>
      ) : null}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import an existing {doc}</DialogTitle>
          <DialogDescription>
            The imported {doc} is accepted as is and the {stage === "requirements" ? "po-brd" : "architect-aad"} run is skipped. Epics are proposed from it; the stage still needs them accepted and its gate approved.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as "paste" | "confluence")} className="gap-3">
          <TabsList>
            <TabsTrigger value="paste">
              <ClipboardPaste aria-hidden />
              Paste markdown
            </TabsTrigger>
            <TabsTrigger value="confluence">
              <BookOpen aria-hidden />
              From Confluence
            </TabsTrigger>
          </TabsList>
          <TabsContent value="paste" className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor={contentId} className="text-xs font-medium">
                {doc} markdown
              </label>
              {content.trim() ? (
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setPreview((p) => !p)} aria-pressed={preview}>
                  {preview ? "Edit" : "Preview"}
                </button>
              ) : null}
            </div>
            {preview ? (
              <div className="relative max-h-[50vh] overflow-y-auto rounded-lg border border-border px-4 py-3">
                <Markdown source={content} size="sm" />
              </div>
            ) : (
              <Textarea
                id={contentId}
                rows={12}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setError(null);
                }}
                spellCheck={false}
                className="max-h-[50vh] font-mono text-xs leading-5"
                placeholder={stage === "requirements" ? "# BRD: Ambassador Agreement Acceptance Reporting\n\n## Business and Product Lead\n…" : "# Architecture Approach - Ambassador Agreement Acceptance Reporting\n…"}
              />
            )}
            {unusual ? <Notice>This does not start with {stage === "requirements" ? '"# BRD: <title>"' : '"# Architecture Approach - <title>"'}; requirements may not be parsed from it.</Notice> : null}
          </TabsContent>
          <TabsContent value="confluence" className="space-y-2">
            <label htmlFor={refId} className="text-xs font-medium">
              Page id or URL
            </label>
            <Input
              id={refId}
              value={ref}
              onChange={(e) => {
                setRef(e.target.value);
                setError(null);
              }}
              placeholder="48213377 or https://…/wiki/spaces/CP/pages/48213377/…"
              className="font-mono text-[13px]"
            />
            {ref.trim() ? <p className="text-[11px] text-muted-foreground">{pageId ? <>Page id <span className="font-mono">{pageId}</span></> : "Not a page id or page URL yet."}</p> : null}
            <p className="text-[11px] text-muted-foreground">Mock: the page is not really fetched; the server returns a sample {doc} for it.</p>
          </TabsContent>
        </Tabs>
        <div className="space-y-1.5">
          <label htmlFor={titleId} className="text-xs font-medium">
            Title <span className="font-normal text-muted-foreground">optional{tab === "paste" && heading ? `; defaults to "${heading}"` : ""}</span>
          </label>
          <Input id={titleId} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        {error ? (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-full" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" className="rounded-full" onClick={submit} disabled={importDoc.isPending || (tab === "paste" ? !content.trim() : !pageId)}>
            {importDoc.isPending ? "Importing…" : projectId ? `Import ${doc}` : `Use this ${doc}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
