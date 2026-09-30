"use client";

/**
 * Screenshots: contact sheets full width, stills in a grid, before/after pairs side by side, and
 * a lightbox dialog (arrow keys step through the stills). Any two stills can be compared.
 */
import { ChevronLeft, ChevronRight, Columns2, Maximize2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Evidence } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { AcChips, EvidenceFacts, EvidenceItem, EvidenceResultPill } from "./EvidenceItem";
import { SegmentChip } from "./RecordingPlayer";
import { beforeAfterPairs } from "./utils";

export interface ScreenshotsTabProps {
  items: Evidence[];
  onSelectAc?: (acId: string) => void;
  activeAc?: string | null;
  highlightId?: string | null;
  onJumpTo?: (id: string) => void;
}

function Thumb({ item, onOpen, selected, onToggleCompare, comparing }: { item: Evidence; onOpen: () => void; selected: boolean; onToggleCompare?: () => void; comparing: boolean }) {
  return (
    <div className={cn("group relative overflow-hidden rounded-[14px] bg-well shadow-[0_0_0_1px_var(--chip-edge),0_10px_24px_-14px_rgb(0_0_0/0.35)] transition-shadow duration-150 hover:shadow-[0_0_0_1px_var(--chip-edge),0_16px_32px_-14px_rgb(0_0_0/0.42)]", selected && "shadow-[0_0_0_2px_var(--ring),0_10px_24px_-14px_rgb(27_111_252/0.5)]")}>
      <button type="button" onClick={comparing && onToggleCompare ? onToggleCompare : onOpen} className="block w-full focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none" aria-label={comparing ? `${selected ? "Remove" : "Add"} ${item.title} ${selected ? "from" : "to"} the comparison` : `Open ${item.title}`}>
        {/* Static mock evidence under /public; next/image adds nothing for these fixed-size PNGs. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.url} alt={item.title} loading="lazy" className="aspect-video w-full object-cover object-top transition-transform duration-150 group-hover:scale-[1.02]" />
      </button>
      {!comparing ? (
        <span className="pointer-events-none absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 ring-1 ring-white/20 backdrop-blur-md transition-opacity duration-150 group-hover:opacity-100">
          <Maximize2 aria-hidden className="size-3.5" />
        </span>
      ) : null}
    </div>
  );
}

export function ScreenshotsTab({ items, onSelectAc, activeAc, highlightId, onJumpTo }: ScreenshotsTabProps) {
  const sheets = items.filter((e) => e.kind === "contact-sheet");
  const stills = items.filter((e) => e.kind === "screenshot" && e.url);
  const pairs = beforeAfterPairs(stills);
  const [open, setOpen] = useState<number | null>(null);
  const [comparing, setComparing] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const lightboxItems = [...stills, ...sheets.filter((s) => s.url)];
  const current = open !== null ? lightboxItems[open] : undefined;

  const step = (d: number) => setOpen((i) => (i === null ? i : (i + d + lightboxItems.length) % lightboxItems.length));
  const toggleCompare = (id: string) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c.slice(-1), id]));
  const compared = compare.map((id) => stills.find((s) => s.id === id)).filter((e): e is Evidence => !!e);

  return (
    <div className="space-y-4">
      {sheets.map((s) => (
        <EvidenceItem key={s.id} item={s} onSelectAc={onSelectAc} activeAc={activeAc} highlighted={highlightId === s.id} onJumpTo={onJumpTo}>
          {s.url ? (
            <button type="button" onClick={() => setOpen(lightboxItems.indexOf(s))} className="block w-full overflow-hidden rounded-[14px] bg-well shadow-[0_0_0_1px_var(--chip-edge),0_10px_24px_-14px_rgb(0_0_0/0.35)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none" aria-label={`Open ${s.title}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt={s.title} loading="lazy" className="w-full" />
            </button>
          ) : null}
        </EvidenceItem>
      ))}

      {pairs.length > 0 ? (
        <section aria-label="Before and after" className="space-y-2">
          <h4 className="text-[13px] font-medium text-heading">Before / after</h4>
          {pairs.map((p) => (
            <div key={`${p.before.id}-${p.after.id}`} className="grid gap-2 @xl/gallery:grid-cols-2">
              {[p.before, p.after].map((e, i) => (
                <figure key={e.id} className="space-y-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={e.url} alt={e.title} loading="lazy" className="aspect-video w-full rounded-[14px] object-cover object-top shadow-[0_0_0_1px_var(--chip-edge),0_10px_24px_-14px_rgb(0_0_0/0.35)]" />
                  <figcaption className="text-xs text-muted-foreground">
                    <SegmentChip label={i === 0 ? "BEFORE" : "AFTER"} className="mr-1.5 h-5" />
                    {e.title}
                  </figcaption>
                </figure>
              ))}
            </div>
          ))}
        </section>
      ) : null}

      {stills.length > 0 ? (
        <section aria-label="Screenshots" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-[13px] font-medium text-heading">
              {stills.length} {stills.length === 1 ? "screenshot" : "screenshots"}
            </h4>
            {stills.length > 1 ? (
              <Button
 type="button"
                variant={comparing ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                aria-pressed={comparing}
                onClick={() => {
                  setComparing((c) => !c);
                  setCompare([]);
                }}
              >
                <Columns2 aria-hidden />
                {comparing ? "Done comparing" : "Compare two"}
              </Button>
            ) : null}
          </div>
          {comparing ? <p className="text-xs text-muted-foreground">Pick two screenshots to see them side by side.</p> : null}
          {comparing && compared.length === 2 ? (
            <div className="grid gap-2 rounded-xl border p-2 @xl/gallery:grid-cols-2">
              {compared.map((e) => (
                <figure key={e.id} className="space-y-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={e.url} alt={e.title} className="aspect-video w-full rounded-[12px] object-cover object-top shadow-[0_0_0_1px_var(--chip-edge)]" />
                  <figcaption className="text-xs text-muted-foreground">
                    <span className="font-mono">{e.id}</span> · {e.title}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}
          <ul className="grid gap-3 @md/gallery:grid-cols-2 @3xl/gallery:grid-cols-3">
            {stills.map((s) => (
              <li key={s.id} id={`evidence-${s.id}`} className={cn("min-w-0 scroll-mt-24 space-y-2 rounded-[20px] bg-field p-2 pb-3 shadow-[0_0_0_1px_var(--rule)]", highlightId === s.id && "shadow-[0_0_0_2px_var(--ring)]", s.supersededBy && "opacity-75")}>
                <Thumb item={s} onOpen={() => setOpen(lightboxItems.indexOf(s))} comparing={comparing} selected={compare.includes(s.id)} onToggleCompare={() => toggleCompare(s.id)} />
                <div className="flex items-start justify-between gap-2 px-1.5 pt-1">
                  <p className="min-w-0 text-sm leading-5 font-medium text-heading">{s.title}</p>
                  <EvidenceResultPill result={s.result} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 px-1.5">
                  <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
                  <AcChips item={s} onSelect={onSelectAc} active={activeAc} />
                </div>
                {s.supersededBy ? <p className="px-0.5 text-xs text-muted-foreground">Superseded by {s.supersededBy}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent
          showCloseButton={false}
          // One minmax(0,1fr) column and min-w-0 children: a long unbroken value (the build ref)
          // must not widen the grid past the dialog on a phone, pushing Close and Next off-screen.
          className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-5xl grid-cols-[minmax(0,1fr)] gap-3 overflow-y-auto p-3 sm:max-w-5xl"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") step(1);
            if (e.key === "ArrowLeft") step(-1);
          }}
        >
          {current ? (
            <>
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <DialogTitle className="text-sm leading-snug break-words">{current.title}</DialogTitle>
                  <DialogDescription className="font-mono text-xs">
                    {current.id} · {open! + 1} of {lightboxItems.length}
                  </DialogDescription>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <EvidenceResultPill result={current.result} />
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => setOpen(null)} aria-label="Close">
                    <X aria-hidden />
                  </Button>
                </div>
              </div>
              <div className="relative min-w-0 overflow-hidden rounded-[16px] bg-well shadow-[0_0_0_1px_var(--chip-edge)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={current.url} alt={current.title} className="max-h-[70vh] w-full max-w-full object-contain" />
                {lightboxItems.length > 1 ? (
                  <>
                    <Button type="button" variant="secondary" size="icon-sm" className="absolute top-1/2 left-2 -translate-y-1/2 shadow" onClick={() => step(-1)} aria-label="Previous screenshot">
                      <ChevronLeft aria-hidden />
                    </Button>
                    <Button type="button" variant="secondary" size="icon-sm" className="absolute top-1/2 right-2 -translate-y-1/2 shadow" onClick={() => step(1)} aria-label="Next screenshot">
                      <ChevronRight aria-hidden />
                    </Button>
                  </>
                ) : null}
              </div>
              <AcChips item={current} />
              <EvidenceFacts item={current} wrap className="min-w-0" />
            </>
          ) : (
            <DialogTitle className="sr-only">Screenshot</DialogTitle>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
