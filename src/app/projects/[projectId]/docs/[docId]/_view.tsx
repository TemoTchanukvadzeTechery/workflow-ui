"use client";

/**
 * /projects/[projectId]/docs/[docId]?v= : a BRD, AAD, plan, memory or ready-for-test document on
 * its own page. The viewer (TOC, versions menu, diff against the previous version) sits beside a
 * side panel with the document's facts, versions, requirements, dependencies, memory update and
 * open questions. ?v= selects a version without a server round trip (history.replaceState keeps
 * useSearchParams in sync); version texts come from the blob store and stay cached.
 */
import { ArrowLeft, ArrowRight, Check, Download, FileX, History, Link2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { actorText, CircleIconButton, EmptyState, ErrorState, RelativeTime, SectionCard, StatusPill } from "@/components/common";
import { DocViewer, versionLabels, type DocViewerMode } from "@/components/docs";
import { Notice } from "@/components/hitl";
import { useRunIndexFor } from "@/components/runs/use-run-index";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy } from "@/hooks/use-copy";
import { stageHref } from "@/hooks/use-stage-params";
import { ApiError } from "@/lib/api/client";
import { useBlobText, useDoc, useProject } from "@/lib/api/queries";
import { stageDef, type DocVersion } from "@/lib/delivery/types";
import { KIND_LABEL, KIND_LONG, SOURCE_LABEL, citationTarget, docStage, docStep, downloadName, downloadText, flashInto, refDomId, sortedVersions, type DocDetail } from "./_model";
import { AboutCard, DependenciesCard, MemoryCard, OpenQuestionsCard, RequirementsCard, SystemsCard, VersionsCard } from "./_side";

export function DocPageView({ projectId, docId }: { projectId: string; docId: string }) {
  const params = useSearchParams();
  const raw = params.get("v");
  const v = raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
  const q = useDoc(projectId, docId);

  if (q.isPending) return <DocPageSkeleton />;
  if (q.error) {
    if (q.error instanceof ApiError && q.error.status === 404) {
      return (
        <SectionCard>
          <EmptyState
            icon={FileX}
            title="Document not found"
            body={`This project has no document "${docId}". It may have been replaced, or the demo data was reset.`}
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href={`/projects/${encodeURIComponent(projectId)}`}>Project overview</Link>
              </Button>
            }
          />
        </SectionCard>
      );
    }
    return <ErrorState title="Could not load the document" error={q.error} onRetry={() => void q.refetch()} />;
  }
  return <Loaded projectId={projectId} doc={q.data.doc as DocDetail} text={q.data.text} version={q.data.version} requested={v} />;
}

function Loaded({ projectId, doc, text: latestText, version, requested }: { projectId: string; doc: DocDetail; text: string; version: DocVersion; requested?: number }) {
  const router = useRouter();
  const versions = useMemo(() => sortedVersions(doc.versions), [doc.versions]);
  const labels = useMemo(() => versionLabels(versions), [versions]);
  const latest = versions[versions.length - 1] ?? version;
  const missing = requested !== undefined && !versions.some((x) => x.n === requested);
  const current = (requested !== undefined ? versions.find((x) => x.n === requested) : undefined) ?? latest;
  const isLatest = current.n === latest.n;
  const labelOf = (n: number) => labels.find((l) => l.n === n)?.label ?? `v${n}`;

  // The doc response carries the latest text; older versions load from the blob store.
  const haveLatest = isLatest && version.n === latest.n;
  const blob = useBlobText(haveLatest ? undefined : current.blob);
  const text = haveLatest ? latestText : blob.data;

  const runIds = useMemo(() => versions.flatMap((x) => (x.runId ? [x.runId] : [])), [versions]);
  const index = useRunIndexFor(runIds).data;
  const stage = docStage(doc.kind, latest.runId ? index?.[latest.runId]?.stage : undefined);
  const stageTitle = stageDef(stage).title;
  const backHref = stageHref(projectId, stage, { step: docStep(doc.kind) });

  // An AAD cites its BRD as B1: jump to that document.
  const bundle = useProject(projectId).data;
  const brdId = bundle?.documents.find((d) => d.kind === "brd")?.id;

  const [mode, setMode] = useState<DocViewerMode>("preview");
  const hasPrev = versions.findIndex((x) => x.n === current.n) > 0;
  const viewMode: DocViewerMode = mode === "diff" && !hasPrev ? "preview" : mode;
  const viewerRef = useRef<HTMLDivElement>(null);

  const setVersion = useCallback(
    (n: number) => {
      const sp = new URLSearchParams(window.location.search);
      if (n === latest.n) sp.delete("v");
      else sp.set("v", String(n));
      const qs = sp.toString();
      window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    },
    [latest.n],
  );

  const compare = (n: number) => {
    setVersion(n);
    setMode("diff");
    requestAnimationFrame(() => {
      const el = viewerRef.current;
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else if (el && el.getBoundingClientRect().top > window.innerHeight * 0.6) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  // Citation chips: R3 → its dependency row, Q2 → its open question, B1 → the BRD.
  const [reveal, setReveal] = useState<{ id: string; n: number }>();
  useEffect(() => {
    if (!reveal) return;
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(refDomId(reveal.id));
      if (el) flashInto(el);
    });
    return () => cancelAnimationFrame(raf);
  }, [reveal]);
  const onCitationClick = useCallback(
    (source: string) => {
      if (/^B\d/.test(source) && doc.kind !== "brd" && brdId) {
        router.push(`/projects/${encodeURIComponent(projectId)}/docs/${encodeURIComponent(brdId)}`);
        return;
      }
      const target = citationTarget(source);
      if (target) setReveal((r) => ({ id: target, n: (r?.n ?? 0) + 1 }));
    },
    [brdId, doc.kind, projectId, router],
  );

  const download = () => {
    if (text !== undefined) downloadText(text, downloadName(doc.path, current.n, isLatest));
  };

  // Seeded BRDs and AADs are titled after the project, which the frame above already names.
  const heading = bundle && doc.title === bundle.project.name ? KIND_LONG[doc.kind] : doc.title;
  const kicker = KIND_LABEL[doc.kind] === heading ? "Document" : KIND_LABEL[doc.kind];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex min-w-0 flex-col gap-5">
        <div>
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-heading focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <ArrowLeft aria-hidden className="size-4" />
            {stageTitle}
          </Link>
        </div>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-6">
          <div className="flex min-w-0 flex-col gap-2.5">
            <p className="text-[13px] text-muted-foreground">
              {kicker} <span aria-hidden>·</span> Stage {stageDef(stage).n} {stageTitle}
            </p>
            <div className="flex min-w-0 items-start gap-2.5">
              <h1 className="min-w-0 text-[30px] leading-[1.12] font-normal tracking-[-0.025em] break-words text-heading sm:text-[38px] sm:leading-[1.08] sm:tracking-[-0.03em] xl:text-[42px]">{heading}</h1>
              <CopyDocLink />
            </div>
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-muted-foreground">
              <StatusPill status={{ kind: "doc", value: doc.status }} />
              <span className="inline-flex h-7 min-w-0 items-center rounded-full bg-well px-2.5 font-mono text-xs break-all text-heading">{doc.path}</span>
              <span aria-hidden>·</span>
              <span>
                {labelOf(current.n)} <span aria-hidden>·</span>{" "}
                {isLatest && doc.status === "accepted" ? `accepted${doc.acceptedBy ? ` by ${actorText(doc.acceptedBy)}` : ""}` : SOURCE_LABEL[current.source].toLowerCase()}
              </span>
              <span aria-hidden>·</span>
              <RelativeTime at={current.at} />
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={download} disabled={text === undefined}>
              <Download aria-hidden />
              Download .md
            </Button>
            <Button asChild>
              <Link href={backHref}>
                Open in {stageTitle}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:grid-rows-[auto_1fr]">
        <div data-doc-side="top" className="flex min-w-0 flex-col gap-4 xl:col-start-2 xl:row-start-1">
          <AboutCard doc={doc} current={current} currentLabel={labelOf(current.n)} total={versions.length} latest={latest} />
          <VersionsCard versions={versions} labels={labels} current={current.n} runIndex={index} onSelect={setVersion} onCompare={compare} />
        </div>

        <div ref={viewerRef} className="flex min-w-0 scroll-mt-16 flex-col gap-3 xl:col-start-1 xl:row-span-2 xl:row-start-1">
          {missing ? (
            <Notice tone="attention" role="status">
              Version {requested} does not exist. Showing the latest, {labelOf(latest.n)}.
            </Notice>
          ) : !isLatest ? (
            <Notice tone="neutral" icon={History} role="status">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>
                  You are viewing {labelOf(current.n)}, an older version.
                </span>
                <button type="button" onClick={() => setVersion(latest.n)} className="rounded font-medium text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                  Show the latest ({labelOf(latest.n)})
                </button>
              </span>
            </Notice>
          ) : null}
          {blob.error && !haveLatest ? (
            <SectionCard>
              <ErrorState size="sm" title={`Could not load ${labelOf(current.n)}`} error={blob.error} onRetry={() => void blob.refetch()} />
            </SectionCard>
          ) : (
            <DocViewer
              key={doc.id}
              path={doc.path}
              text={text ?? ""}
              loading={text === undefined}
              versions={versions}
              currentVersion={current.n}
              onVersionChange={setVersion}
              mode={viewMode}
              onModeChange={setMode}
              onCitationClick={onCitationClick}
            />
          )}
        </div>

        <div data-doc-side="rest" className="flex min-w-0 flex-col gap-4 xl:col-start-2 xl:row-start-2 xl:self-start">
          <RequirementsCard doc={doc} />
          <DependenciesCard deps={doc.dependencies} reveal={reveal?.id} kind={doc.kind} />
          {doc.memory ? <MemoryCard memory={doc.memory} isMemoryDoc={doc.kind === "memory"} /> : null}
          <OpenQuestionsCard questions={doc.openQuestions ?? []} reveal={reveal?.id} onCitationClick={onCitationClick} />
          <SystemsCard systems={doc.systems ?? []} />
        </div>
      </div>
    </div>
  );
}

/** The reference's raised "copy link" circle beside the title. */
function CopyDocLink() {
  const { copied, copy } = useCopy();
  return (
    <CircleIconButton
      variant="raised"
      size="sm"
      icon={copied ? Check : Link2}
      label={copied ? "Link copied" : "Copy link to this document"}
      className="mt-1 sm:mt-2"
      onClick={() => void copy(window.location.href, "the document link")}
    />
  );
}

function DocPageSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading document">
      <Skeleton className="h-7 w-32 rounded-full" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-9 w-2/3 max-w-xl" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="card-surface flex flex-col gap-3 rounded-2xl p-5">
          <Skeleton className="h-5 w-48" />
          {[92, 100, 84, 96, 70, 100, 88, 60].map((w, i) => (
            <Skeleton key={i} className="h-4" style={{ width: `${w}%` }} />
          ))}
        </div>
        <div className="flex flex-col gap-4">
          <div className="card-surface flex flex-col gap-3 rounded-2xl p-4">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-16 w-full" />
          </div>
          <div className="card-surface flex flex-col gap-3 rounded-2xl p-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
