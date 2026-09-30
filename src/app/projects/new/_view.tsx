"use client";

/**
 * New project: the Stage 1 intake (name, summary, the PO's request, Jira/Confluence sources and
 * notes, run options) and, optionally, an existing BRD (and AAD) to start mid-flow. "Save draft"
 * creates the project without a run; "Start requirements run" also starts po-brd.
 */
import { BookOpen, ClipboardPaste, FileText, Info, Network, Play, RefreshCw, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader, SectionCard } from "@/components/common";
import { emptyIntakeValue, ImportDocDialog, IntakeForm, validateIntake, type IntakeErrors, type IntakeFormValue } from "@/components/projects";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCreateProject } from "@/lib/api/queries";
import type { CreateProjectBody, ImportBody } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";

type DocStage = "requirements" | "architecture";
type Imports = Partial<Record<DocStage, ImportBody>>;

const DOC: Record<DocStage, { label: string; icon: typeof FileText; workflow: string; stageTitle: string }> = {
  requirements: { label: "BRD", icon: FileText, workflow: "po-brd", stageTitle: "Requirements" },
  architecture: { label: "AAD", icon: Network, workflow: "architect-aad", stageTitle: "Architecture" },
};

function importTitle(body: ImportBody): string {
  if (body.title) return body.title;
  if (body.source === "confluence") return `Confluence page ${body.ref ?? ""}`.trim();
  const heading = /^#\s+(.+)$/m.exec(body.content)?.[1]?.trim();
  return heading ?? "Pasted markdown";
}

function ImportSlot({ stage, value, onChange, disabled, disabledReason }: { stage: DocStage; value?: ImportBody; onChange: (v?: ImportBody) => void; disabled?: boolean; disabledReason?: string }) {
  const doc = DOC[stage];
  const Icon = doc.icon;
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("rounded-xl border p-3", value ? "border-primary/30 bg-primary-soft/50" : "border-dashed")}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-[13px] font-medium text-foreground">{value ? `${doc.label} ready to import` : `Existing ${doc.label}`}</p>
          {value ? (
            <>
              <p className="truncate text-xs text-foreground/85" title={importTitle(value)}>
                {importTitle(value)}
              </p>
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                {value.source === "confluence" ? <BookOpen aria-hidden className="size-3" /> : <ClipboardPaste aria-hidden className="size-3" />}
                {value.source === "confluence" ? `Fetched from Confluence page ${value.ref}` : `Pasted, ${value.content.split("\n").length} lines`}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{disabled && disabledReason ? disabledReason : `Skips the ${doc.workflow} run. Paste markdown or give a Confluence page.`}</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 pl-11">
        <ImportDocDialog
          stage={stage}
          open={open}
          onOpenChange={setOpen}
          onSubmit={(body) => onChange(body)}
          trigger={
            <Button variant="outline" size="sm" className="rounded-full bg-card" disabled={disabled}>
              {value ? <RefreshCw aria-hidden /> : <Icon aria-hidden />}
              {value ? "Replace" : `Import ${doc.label}`}
            </Button>
          }
        />
        {value ? (
          <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" onClick={() => onChange(undefined)} aria-label={`Remove the imported ${doc.label}`}>
            <Trash2 aria-hidden />
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function NewProjectView() {
  const router = useRouter();
  const create = useCreateProject();
  const [value, setValue] = useState<IntakeFormValue>(emptyIntakeValue);
  const [imports, setImports] = useState<Imports>({});
  // The last Save draft / Start attempt: validation shows only after one, and follows the current values.
  const [attempted, setAttempted] = useState<"draft" | "start" | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"draft" | "start" | null>(null);

  const hasBrd = !!imports.requirements;
  const liveErrors = validateIntake(value, { forRun: attempted === "start" && !hasBrd });
  const errors: IntakeErrors = attempted ? { name: liveErrors.name, options: liveErrors.options, request: liveErrors.request } : { options: liveErrors.options };
  const footerError = (attempted ? (liveErrors.name ?? liveErrors.options ?? liveErrors.request) : undefined) ?? serverError;
  const busy = create.isPending;
  const change = (next: IntakeFormValue) => {
    setValue(next);
    setServerError(null);
  };

  const setImport = (stage: DocStage, body?: ImportBody) =>
    setImports((prev) => {
      const next = { ...prev, [stage]: body };
      if (stage === "requirements" && !body) delete next.architecture; // an AAD needs a BRD
      return next;
    });

  const submit = async (action: "draft" | "start") => {
    setAttempted(action);
    setServerError(null);
    const errs = validateIntake(value, { forRun: action === "start" && !hasBrd });
    if (Object.keys(errs).length > 0) return;
    const list = (Object.entries(imports) as Array<[DocStage, ImportBody | undefined]>).filter((e): e is [DocStage, ImportBody] => !!e[1]).map(([stage, body]) => ({ ...body, stage }));
    const body: CreateProjectBody = {
      name: value.name.trim(),
      ...(value.summary.trim() ? { summary: value.summary.trim() } : {}),
      intake: value.intake,
      start: action === "start" && !hasBrd,
      ...(list.length ? { imports: list } : {}),
    };
    setPendingAction(action);
    try {
      const bundle = await create.mutateAsync(body);
      const { project } = bundle;
      toast.success(hasBrd ? `${project.name} created from the imported ${imports.architecture ? "BRD and AAD" : "BRD"}` : action === "start" ? `${project.name} created · po-brd is starting` : `${project.name} saved as a draft`);
      router.push(`/projects/${encodeURIComponent(project.id)}/${project.currentStage}`);
    } catch (e) {
      setServerError(e instanceof Error ? e.message : String(e));
      setPendingAction(null);
    }
  };

  return (
    <div className="@container flex min-w-0 flex-col gap-6">
      <PageHeader
        kicker="Stage 1 · Requirements intake"
        title="New project"
        description="Tell po-brd what the Product Owner wants and where to look: Jira issues, Confluence pages and notes. Or start from a BRD you already have."
      />

      <div className="grid min-w-0 items-start gap-4 @5xl:grid-cols-[minmax(0,1fr)_340px]">
        <SectionCard title="The request" description="This becomes the po-brd run input. Nothing is sent until you save or start.">
          <IntakeForm value={value} onChange={change} errors={errors} mode="create" importingBrd={hasBrd} disabled={busy} />
        </SectionCard>

        <SectionCard
          title="Start from an existing document"
          description="Import a BRD, and optionally its AAD, to skip those runs. The project still proposes epics from them, and each stage still needs its epics accepted and its gate approved."
          className="@5xl:sticky @5xl:top-16"
          bodyClassName="flex flex-col gap-3"
        >
          <ImportSlot stage="requirements" value={imports.requirements} onChange={(b) => setImport("requirements", b)} disabled={busy} />
          <ImportSlot stage="architecture" value={imports.architecture} onChange={(b) => setImport("architecture", b)} disabled={busy || !hasBrd} disabledReason="Import a BRD first; the AAD is written against it." />
        </SectionCard>
      </div>

      <div className="card-surface z-10 flex flex-col gap-3 rounded-2xl p-4 @3xl:sticky @3xl:bottom-3 @3xl:flex-row @3xl:items-center @3xl:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
            <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {hasBrd
                ? `The imported ${imports.architecture ? "BRD and AAD are" : "BRD is"} accepted as v1 and no run starts. Next: accept the proposed epics and approve Requirements.`
                : "po-brd searches Jira & Confluence first, then asks you to confirm the dependencies it found before drafting the BRD."}
            </span>
          </p>
          {footerError ? (
            <p id="start-hint" role="alert" className="pl-5 text-xs text-destructive">
              {footerError}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!hasBrd ? (
            <Button variant="outline" className="rounded-full" onClick={() => void submit("draft")} disabled={busy}>
              {pendingAction === "draft" ? <Spinner /> : <Save aria-hidden />}
              Save draft
            </Button>
          ) : null}
          <Button className="rounded-full" onClick={() => void submit("start")} disabled={busy} aria-describedby={footerError ? "start-hint" : undefined}>
            {pendingAction === "start" ? <Spinner /> : hasBrd ? <FileText aria-hidden /> : <Play aria-hidden />}
            {hasBrd ? "Create project" : "Start requirements run"}
          </Button>
        </div>
      </div>
    </div>
  );
}
