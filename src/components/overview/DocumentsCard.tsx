"use client";

/**
 * The project's documents in stage order: BRD, AAD, shared memory, implementation plan and the
 * ready-for-test note. Each produced document links to the full-page viewer; missing ones say
 * which stage produces them.
 */
import { BookMarked, ChevronRight, ClipboardCheck, FileText, ListTree, Network, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { actorText, RelativeTime, SectionCard, StatusPill } from "@/components/common";
import { stageDef, type DocumentArtifact, type DocumentKind, type ProjectBundle, type StageId } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";

const SLOTS: ReadonlyArray<{ kind: DocumentKind; label: string; icon: LucideIcon; stage: StageId; by: string }> = [
  { kind: "brd", label: "BRD", icon: FileText, stage: "requirements", by: "po-brd drafts it in Requirements" },
  { kind: "aad", label: "AAD", icon: Network, stage: "architecture", by: "architect-aad drafts it in Architecture" },
  { kind: "memory", label: "Memory", icon: BookMarked, stage: "requirements", by: "Updated after each accepted document" },
  { kind: "plan", label: "Plan", icon: ListTree, stage: "implementation", by: "dev-plan generates it in Implementation" },
  { kind: "ready-for-test", label: "Ready for test", icon: ClipboardCheck, stage: "implementation", by: "Written at the Implementation gate" },
];

function latest(docs: DocumentArtifact[], kind: DocumentKind): DocumentArtifact | undefined {
  const of = docs.filter((d) => d.kind === kind);
  return [...of].reverse().find((d) => d.status !== "superseded") ?? of.at(-1);
}

function statusLine(doc: DocumentArtifact): { text: string; at?: number } {
  const v = doc.versions.at(-1);
  if (doc.status === "accepted") {
    const how = v?.source === "import" ? "Imported" : "Accepted";
    return { text: `${how}${doc.acceptedBy ? ` by ${actorText(doc.acceptedBy)}` : ""}`, at: doc.acceptedAt ?? v?.at };
  }
  if (doc.status === "draft") return { text: v?.roundKey ? `Draft from ${v.roundKey}` : "Draft, not accepted yet", at: v?.at };
  return { text: "Superseded", at: v?.at };
}

/**
 * Memory is updated by the po-brd / architect-aad runs. When every accepted BRD and AAD was
 * imported instead, no run wrote memory, so "not produced yet" would promise something that is
 * not coming.
 */
function memoryImportedOnly(docs: DocumentArtifact[]): boolean {
  const accepted = docs.filter((d) => (d.kind === "brd" || d.kind === "aad") && d.status === "accepted");
  return accepted.length > 0 && accepted.every((d) => d.versions.at(-1)?.source === "import");
}

function DocRow({ projectId, slot, doc, missingText }: { projectId: string; slot: (typeof SLOTS)[number]; doc?: DocumentArtifact; missingText?: string }) {
  const Icon = slot.icon;
  if (!doc) {
    return (
      <div className="flex items-center gap-3.5 px-5 py-3.5 sm:px-7">
        <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-dashed border-circle-border text-muted-foreground">
          <Icon className="size-[18px]" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] leading-5 text-muted-foreground">{slot.label}</span>
          <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{missingText ?? `Not produced yet · ${slot.by}`}</span>
        </span>
        <span className="hidden text-xs text-muted-foreground @sm:inline">Stage {stageDef(slot.stage).n}</span>
      </div>
    );
  }
  const line = statusLine(doc);
  const n = doc.versions.at(-1)?.n ?? doc.versions.length;
  const memory = doc.kind === "memory" ? doc.memory?.status : undefined;
  return (
    <Link
      href={`/projects/${encodeURIComponent(projectId)}/docs/${encodeURIComponent(doc.id)}`}
      className="group flex items-center gap-3.5 px-5 py-3.5 transition-colors duration-150 hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.03] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset sm:px-7"
    >
      <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-well text-heading">
        <Icon className="size-[18px]" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-[15px] leading-5 font-medium text-heading">{slot.label}</span>
          {n ? <span className="font-mono text-xs text-muted-foreground">v{n}</span> : null}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
          {line.text}
          {line.at ? (
            <>
              {" · "}
              <RelativeTime at={line.at} />
            </>
          ) : null}
        </span>
        <span className="block truncate font-mono text-xs text-muted-foreground">{doc.path}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <StatusPill status={{ kind: "doc", value: doc.status }} size="sm" />
        {memory ? <StatusPill status={{ kind: "memory", value: memory }} size="sm" variant="plain" /> : null}
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground/60 transition-transform duration-150 group-hover:translate-x-0.5" />
    </Link>
  );
}

export function DocumentsCard({ bundle, className }: { bundle: ProjectBundle; className?: string }) {
  const rows = SLOTS.map((slot) => ({ slot, doc: latest(bundle.documents, slot.kind) }));
  const produced = rows.filter((r) => r.doc).length;
  return (
    <SectionCard title="Documents" description={`${produced} of ${SLOTS.length} produced · agent output stays Draft until a person accepts it`} flush className={cn("@container", className)}>
      <ul className="divide-y divide-rule border-t border-rule">
        {rows.map(({ slot, doc }) => (
          <li key={slot.kind}>
            <DocRow projectId={bundle.project.id} slot={slot} doc={doc} missingText={slot.kind === "memory" && !doc && memoryImportedOnly(bundle.documents) ? "No memory update (documents imported)" : undefined} />
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
