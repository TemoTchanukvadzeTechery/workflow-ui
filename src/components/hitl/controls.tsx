"use client";

/**
 * Form controls for human requests, built on Radix radio groups so arrow keys, Home/End and
 * focus rings behave like native radios. Pills are weft's "choice" control, drawn as the
 * reference's segmented control (a well track, the chosen segment raised); cards are its "cards"
 * control (an option that carries a description), drawn as raised segments in a well.
 */
import { Check, X, type LucideIcon } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TONE_CLASS, type Tone } from "./bits";

export interface PillOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: LucideIcon;
  disabled?: boolean;
}

export function PillChoice<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  ariaLabelledBy,
  size = "default",
  className,
  disabled,
}: {
  value: T | "" | undefined;
  onChange: (value: T) => void;
  options: readonly PillOption<T>[];
  ariaLabel?: string;
  ariaLabelledBy?: string;
  size?: "sm" | "default";
  className?: string;
  disabled?: boolean;
}) {
  return (
    <RadioGroupPrimitive.Root
      value={value ?? ""}
      onValueChange={(v) => onChange(v as T)}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      orientation="horizontal"
      disabled={disabled}
      className={cn("inline-flex max-w-full flex-wrap items-center gap-1 bg-well", size === "sm" ? "rounded-[12px] p-[3px]" : "rounded-[16px] p-1", className)}
    >
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <RadioGroupPrimitive.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className={cn(
              "inline-flex items-center gap-1.5 font-medium whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow] duration-150 outline-none hover:text-heading focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-(--disabled-opacity)",
              size === "sm" ? "h-[30px] rounded-[9px] px-3 text-[13px]" : "h-9 rounded-[12px] px-3.5 text-sm",
              "data-[state=checked]:bg-raised data-[state=checked]:text-heading data-[state=checked]:shadow-(--raised-shadow)",
            )}
          >
            {Icon ? <Icon aria-hidden className={size === "sm" ? "size-3.5" : "size-4"} strokeWidth={1.9} /> : null}
            {option.label}
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}

export interface CardOption<T extends string> {
  value: T;
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  /** Tints the icon; selection itself is shown by the ring and check mark. */
  tone?: Tone;
  disabled?: boolean;
}

export function OptionCards<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  ariaLabelledBy,
  className,
  columns,
  disabled,
}: {
  value: T | "" | undefined;
  onChange: (value: T) => void;
  options: readonly CardOption<T>[];
  ariaLabel?: string;
  ariaLabelledBy?: string;
  className?: string;
  columns?: 1 | 2 | 3;
  disabled?: boolean;
}) {
  const cols = columns ?? (options.length >= 3 ? 3 : options.length === 2 ? 2 : 1);
  return (
    <RadioGroupPrimitive.Root
      value={value ?? ""}
      onValueChange={(v) => onChange(v as T)}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      disabled={disabled}
      className={cn("grid gap-1 rounded-[20px] bg-well p-1", cols === 3 ? "@xl:grid-cols-3" : cols === 2 ? "@md:grid-cols-2" : "", className)}
    >
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <RadioGroupPrimitive.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className={cn(
              "group relative flex h-full flex-col items-start gap-1.5 rounded-[16px] p-3.5 text-left transition-[background-color,box-shadow] duration-150 outline-none hover:bg-raised/60 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-(--disabled-opacity)",
              "data-[state=checked]:bg-raised data-[state=checked]:shadow-(--raised-shadow)",
            )}
          >
            <span className="flex w-full items-center gap-2">
              {Icon ? (
                <span className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full", TONE_CLASS[option.tone ?? "neutral"])}>
                  <Icon aria-hidden className="size-4" strokeWidth={1.9} />
                </span>
              ) : null}
              <span className="flex-1 text-sm font-medium text-muted-foreground group-hover:text-heading group-data-[state=checked]:text-heading">{option.title}</span>
              <span
                aria-hidden
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-circle-border text-ink-foreground transition-colors group-data-[state=checked]:border-transparent group-data-[state=checked]:bg-ink"
              >
                <Check className="size-3 opacity-0 group-data-[state=checked]:opacity-100" strokeWidth={3} />
              </span>
            </span>
            {option.description ? <span className="text-[13px] leading-5 text-muted-foreground">{option.description}</span> : null}
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}

/** Multi-select pills for an array-of-enum field. */
export function ChipToggles({ values, onChange, options, ariaLabel }: { values: string[]; onChange: (values: string[]) => void; options: readonly { value: string; label: ReactNode }[]; ariaLabel: string }) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = values.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? values.filter((v) => v !== option.value) : [...values, option.value])}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-[color,background-color,box-shadow] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              on ? "bg-raised text-heading shadow-[0_0_0_1px_var(--chip-edge),var(--raised-shadow)]" : "bg-well text-muted-foreground hover:bg-well-hover hover:text-heading",
            )}
          >
            {on ? <Check aria-hidden className="size-3.5" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Free-form chips: type a value, press Enter (or Add). `normalize` returns the value to store or
 * an error message; duplicates are ignored.
 */
export function ChipInput({
  values,
  onChange,
  normalize,
  placeholder,
  label,
  addLabel = "Add",
  renderChip,
  disabled,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  normalize: (raw: string) => { value: string } | { error: string };
  placeholder?: string;
  label: string;
  addLabel?: string;
  renderChip?: (value: string) => ReactNode;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const add = () => {
    const raw = draft.trim();
    if (!raw) return;
    // Accept several at once: "CP-1, CP-2" or one per line.
    const pieces = raw.split(/[\s,]+/).filter(Boolean);
    const next = [...values];
    for (const piece of pieces.length > 1 ? pieces : [raw]) {
      const result = normalize(piece);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      if (!next.includes(result.value)) next.push(result.value);
    }
    onChange(next);
    setDraft("");
    setError(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="font-mono text-[13px]"
        />
        <Button type="button" variant="secondary" size="lg" onClick={add} disabled={disabled || !draft.trim()}>
          {addLabel}
        </Button>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {values.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${label}: ${values.length}`}>
          {values.map((value) => (
            <li key={value} className="inline-flex h-7 items-center gap-1 rounded-full bg-well pr-1 pl-2.5 font-mono text-xs text-heading">
              {renderChip ? renderChip(value) : value}
              <button
                type="button"
                onClick={() => onChange(values.filter((v) => v !== value))}
                aria-label={`Remove ${value}`}
                className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-raised hover:text-heading focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A labelled block inside a form: label, optional hint, control. */
export function FormRow({ label, htmlFor, id, hint, required, children, className }: { label: ReactNode; htmlFor?: string; id?: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline gap-2">
        {htmlFor ? (
          <label htmlFor={htmlFor} id={id} className="text-sm font-medium text-heading">
            {label}
          </label>
        ) : (
          <span id={id} className="text-sm font-medium text-heading">
            {label}
          </span>
        )}
        {required ? <span className="text-xs text-muted-foreground">required</span> : null}
      </div>
      {children}
      {hint ? <p className="text-[13px] leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
