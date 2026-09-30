"use client";

import { ChevronUp, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useId, useMemo, useState, type FormEvent, type UIEvent } from "react";
import { cn } from "@/lib/utils";
import { useElementSize } from "./use-element-size";

export interface PromptSuggestion {
  /** The highlighted token, e.g. "/inbox". */
  token: string;
  /** What it does, for the accessible name and the hover title: "Open the inbox: 9 items waiting". */
  label: string;
  /** Makes the chip a link. Without it the chip puts its token into the field. */
  href?: string;
}

export interface PromptBandProps {
  /** The muted question beside the sparkle; it also labels the field. */
  title: string;
  /** Field placeholder; replaced by `compactPlaceholder` when it would not fit. */
  placeholder?: string;
  /** The placeholder for a narrow field. Default "Search or type a command". */
  compactPlaceholder?: string;
  /** Token chips: inside the field when it is wide, on their own scrolling row under it when not. */
  suggestions?: PromptSuggestion[];
  /** Enter in the field, with its text (possibly empty). The text stays in the field. */
  onSubmit?: (text: string) => void;
  /** Start with only the question row showing. */
  defaultCollapsed?: boolean;
  className?: string;
}

const CHIP =
  "token-chip h-7 shrink-0 text-[14px] leading-none outline-none transition-[filter] hover:brightness-[0.97] focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:brightness-125";

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Width of `text` in the element's font, or undefined when it cannot be measured (SSR). */
function textWidth(text: string, el: Element): number | undefined {
  if (typeof document === "undefined") return undefined;
  if (measureCtx === undefined) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return undefined;
  const s = getComputedStyle(el);
  measureCtx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
  return measureCtx.measureText(text).width;
}

/**
 * A row of token chips that scrolls sideways when it overflows, with its edges faded where more
 * chips hide.
 */
function ChipRow({ suggestions, onToken, className }: { suggestions: PromptSuggestion[]; onToken: (token: string) => void; className?: string }) {
  const [rowRef, row] = useElementSize<HTMLDivElement>();
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [scroll, setScroll] = useState(0);
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      rowRef(node);
      setEl(node);
    },
    [rowRef],
  );
  // `row.width` only re-renders on resize; the scroll range is measured on the element itself.
  const overflow = el && row.width > 0 ? el.scrollWidth - el.clientWidth : 0;
  const fadeStart = overflow > 1 && scroll > 1;
  const fadeEnd = overflow > 1 && scroll < overflow - 1;
  const mask =
    fadeStart || fadeEnd
      ? `linear-gradient(90deg, ${fadeStart ? "transparent 0, #000 28px" : "#000 0"}, ${fadeEnd ? "#000 calc(100% - 36px), transparent 100%" : "#000 100%"})`
      : undefined;
  return (
    <div
      ref={ref}
      role="group"
      aria-label="Suggestions"
      onScroll={(e: UIEvent<HTMLDivElement>) => setScroll(e.currentTarget.scrollLeft)}
      className={cn("flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      {suggestions.map((s) =>
        s.href ? (
          <Link key={s.token} href={s.href} title={s.label} aria-label={s.label} className={CHIP}>
            {s.token}
          </Link>
        ) : (
          <button key={s.token} type="button" title={s.label} aria-label={s.label} onClick={() => onToken(s.token)} className={CHIP}>
            {s.token}
          </button>
        ),
      )}
    </div>
  );
}

/**
 * The frosted prompt band (STYLE.md 5): a sparkle and a muted question over a white field that
 * holds token chips. It sits at the base of a card, overlapping what is above it. Enter hands the
 * field's text to `onSubmit` (Home opens the command palette with it). The chevron collapses the
 * band to its question row.
 */
export function PromptBand({ title, placeholder = "", compactPlaceholder = "Search or type a command", suggestions = [], onSubmit, defaultCollapsed = false, className }: PromptBandProps) {
  const [open, setOpen] = useState(!defaultCollapsed);
  const [text, setText] = useState("");
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  const [fieldRef, field] = useElementSize<HTMLInputElement>();
  const regionId = useId();
  const inputId = useId();

  const inputRef = useCallback(
    (node: HTMLInputElement | null) => {
      fieldRef(node);
      setInput(node);
    },
    [fieldRef],
  );

  // The full placeholder while it fits the field, else the compact one.
  const shown = useMemo(() => {
    if (!input || field.width <= 0 || !placeholder) return placeholder;
    const w = textWidth(placeholder, input);
    return w === undefined || w <= field.width - 2 ? placeholder : compactPlaceholder;
  }, [input, field.width, placeholder, compactPlaceholder]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit?.(text);
  };

  const insertToken = (token: string) => {
    setText((t) => `${t.trimEnd()}${t.trim() ? " " : ""}${token} `);
    input?.focus();
  };

  const hasChips = suggestions.length > 0;

  return (
    <div className={cn("@container/band prompt-band relative isolate overflow-hidden rounded-[24px] px-2 pt-1 pb-2 sm:px-2.5 sm:pb-2.5", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(45%_110%_at_50%_0%,rgba(255,255,255,.6),transparent_70%)] dark:bg-[radial-gradient(45%_110%_at_50%_0%,rgba(120,170,255,.16),transparent_70%)]"
      />
      <div className="flex h-11 items-center gap-2.5 pr-1 pl-3">
        <Sparkles aria-hidden className="size-[18px] shrink-0 text-[#3F5B84] dark:text-[#A9C4F5]" strokeWidth={1.75} />
        <label htmlFor={inputId} className="min-w-0 flex-1 truncate text-[15px] text-[#3B4D68] dark:text-[#C3D1EA]">
          {title}
        </label>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          aria-label={open ? "Hide the prompt" : "Show the prompt"}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[#3B4D68] outline-none transition-colors hover:bg-white/45 focus-visible:ring-3 focus-visible:ring-ring/50 dark:text-[#C3D1EA] dark:hover:bg-white/10"
        >
          <ChevronUp aria-hidden className={cn("size-4 transition-transform duration-200", !open && "rotate-180")} />
        </button>
      </div>
      <div id={regionId} hidden={!open}>
        <form onSubmit={submit} className="prompt-field flex min-h-11 items-center gap-2 py-1 pr-1.5 pl-4 focus-within:ring-3 focus-within:ring-ring/25">
          <input
            ref={inputRef}
            id={inputId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={shown}
            autoComplete="off"
            enterKeyHint="go"
            className="h-9 min-w-0 flex-1 bg-transparent text-[15px] text-ellipsis text-foreground outline-none placeholder:text-muted-foreground"
          />
          {hasChips && <ChipRow suggestions={suggestions} onToken={insertToken} className="hidden max-w-[58%] shrink @lg/band:flex" />}
        </form>
        {/* A narrow band keeps the field for typing and gives the chips their own row. */}
        {hasChips && <ChipRow suggestions={suggestions} onToken={insertToken} className="mt-2 px-1 @lg/band:hidden" />}
      </div>
    </div>
  );
}
