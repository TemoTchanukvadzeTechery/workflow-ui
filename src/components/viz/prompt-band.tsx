"use client";

import { ArrowUp, ChevronUp, Sparkles } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface PromptSuggestion {
  /** Shown in the token chip: "/SMS", "/inbox". */
  token: string;
  /** Accessible name and tooltip: "Open SMS Consent Capture". */
  label: string;
  /** Jump here on click. Without it, the token is appended to the input. */
  href?: string;
}

export interface PromptBandProps {
  /** The question in the band header. Default "What would you like to do next?". */
  title?: string;
  /** Input placeholder. */
  placeholder: string;
  /** Token chips beside the input. */
  suggestions?: PromptSuggestion[];
  /** Enter (or the send button) with the trimmed text, possibly "". */
  onSubmit: (text: string) => void;
  /** Start with only the header row showing. */
  defaultCollapsed?: boolean;
  className?: string;
}

/** Token chip (STYLE.md 3). Text darkened from #C2610C to #A34F08 for AA at 14px on the peach fill. */
const TOKEN =
  "inline-flex h-7 shrink-0 items-center rounded-[6px] border border-[#FFCA88] bg-[#FDE9C9] px-1.5 text-[14px] leading-none whitespace-nowrap text-[#A34F08] outline-none transition-colors hover:bg-[#FCDDB0] focus-visible:ring-3 focus-visible:ring-ring/50 dark:border-[#FFCA88]/35 dark:bg-[#F59E0B]/14 dark:text-[#F5B066] dark:hover:bg-[#F59E0B]/22";

function Token({ s, onPick }: { s: PromptSuggestion; onPick: (s: PromptSuggestion) => void }) {
  return s.href ? (
    <Link href={s.href} title={s.label} aria-label={s.label} className={TOKEN}>
      {s.token}
    </Link>
  ) : (
    <button type="button" title={s.label} aria-label={s.label} onClick={() => onPick(s)} className={TOKEN}>
      {s.token}
    </button>
  );
}

/**
 * The frosted blue prompt band (STYLE.md 5) that sits over the bottom of a card: a sparkle and a
 * muted question, a collapse chevron, and a white 44px input with token-chip suggestions. Give it
 * a negative top margin (for example `-mt-10`) to overlap the chart above it.
 */
export function PromptBand({ title = "What would you like to do next?", placeholder, suggestions = [], onSubmit, defaultCollapsed = false, className }: PromptBandProps) {
  const [text, setText] = useState("");
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyId = useId();
  const inputId = useId();

  const pick = (s: PromptSuggestion) => {
    setText((t) => (t.trim() ? `${t.trimEnd()} ${s.token} ` : `${s.token} `));
    inputRef.current?.focus();
  };

  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-[24px] px-2 pt-1 pb-2",
        "bg-[linear-gradient(180deg,rgba(211,227,246,.86),#C7DCF3)] backdrop-blur-xl backdrop-saturate-150",
        "shadow-[0_-18px_40px_-18px_rgba(40,110,230,.45),inset_0_1px_0_rgba(255,255,255,.75),0_0_0_1px_rgba(255,255,255,.5)]",
        "dark:bg-[linear-gradient(180deg,rgba(34,52,88,.82),rgba(26,40,70,.94))] dark:shadow-[0_-18px_40px_-18px_rgba(40,110,230,.35),inset_0_1px_0_rgba(255,255,255,.08),0_0_0_1px_rgba(255,255,255,.06)]",
        className,
      )}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(45%_110%_at_50%_0%,rgba(255,255,255,.6),transparent_70%)] dark:bg-[radial-gradient(45%_110%_at_50%_0%,rgba(120,170,255,.16),transparent_70%)]" />
      <div className="flex h-11 items-center gap-2.5 pr-1 pl-3">
        <Sparkles aria-hidden className="size-[18px] shrink-0 text-[#3F5B84] dark:text-[#A9C4F5]" strokeWidth={1.75} />
        <label htmlFor={inputId} className="min-w-0 flex-1 truncate text-[15px] text-[#3B4D68] dark:text-[#C3D1EA]">
          {title}
        </label>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={collapsed ? "Show the prompt" : "Hide the prompt"}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[#3B4D68] outline-none transition-colors hover:bg-white/45 focus-visible:ring-3 focus-visible:ring-ring/50 dark:text-[#C3D1EA] dark:hover:bg-white/10"
        >
          <ChevronUp aria-hidden className={cn("size-4 transition-transform duration-200", collapsed && "rotate-180")} />
        </button>
      </div>
      <div id={bodyId} hidden={collapsed}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(text.trim());
          }}
          className={cn(
            "flex min-h-11 items-center gap-2 rounded-[12px] bg-white py-1 pr-1.5 pl-4",
            "shadow-[0_1px_2px_rgba(0,0,0,.06),0_10px_24px_-14px_rgba(30,70,140,.45)] focus-within:ring-3 focus-within:ring-[#1B6FFC]/25",
            "dark:bg-[#1B1D22] dark:shadow-[0_0_0_1px_rgba(255,255,255,.08),0_10px_24px_-14px_rgba(0,0,0,.6)]",
          )}
        >
          <input
            ref={inputRef}
            id={inputId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            enterKeyHint="go"
            className="h-9 min-w-0 flex-1 bg-transparent text-[15px] text-[#1A1A1A] outline-none placeholder:text-[#6E6E6E] dark:text-[#F4F4F5] dark:placeholder:text-[#8E9199]"
          />
          {suggestions.length > 0 && (
            <div className="hidden max-w-[55%] items-center gap-1.5 overflow-hidden sm:flex" aria-label="Suggestions" role="group">
              {suggestions.map((s) => (
                <Token key={s.token} s={s} onPick={pick} />
              ))}
            </div>
          )}
          {text.trim() && (
            <button
              type="submit"
              aria-label="Go"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] text-[#3B4D68] outline-none transition-colors hover:bg-[#EAEAEA] focus-visible:ring-3 focus-visible:ring-ring/50 dark:text-[#C3D1EA] dark:hover:bg-white/10"
            >
              <ArrowUp aria-hidden className="size-4" />
            </button>
          )}
        </form>
        {suggestions.length > 0 && (
          <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto px-1 sm:hidden" aria-label="Suggestions" role="group">
            {suggestions.map((s) => (
              <Token key={s.token} s={s} onPick={pick} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
