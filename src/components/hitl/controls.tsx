"use client";

/**
 * Form controls for human requests, built on Radix radio groups so arrow keys, Home/End and
 * focus rings behave like native radios. Pills are weft's "choice" control, cards its "cards"
 * control (an option that carries a description).
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
      className={cn("inline-flex flex-wrap items-center gap-1 rounded-full bg-muted p-1", className)}
    >
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <RadioGroupPrimitive.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
              size === "sm" ? "h-6 px-2.5 text-xs" : "h-8 px-3.5 text-[13px]",
              "data-[state=checked]:bg-card data-[state=checked]:text-foreground data-[state=checked]:shadow-sm",
            )}
          >
            {Icon ? <Icon aria-hidden className="size-3.5" /> : null}
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
      className={cn("grid gap-2", cols === 3 ? "@xl:grid-cols-3" : cols === 2 ? "@md:grid-cols-2" : "", className)}
    >
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <RadioGroupPrimitive.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className={cn(
              "group relative flex h-full flex-col items-start gap-1 rounded-xl border border-border bg-card p-3 text-left transition-colors duration-150 outline-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
              "data-[state=checked]:border-primary data-[state=checked]:ring-1 data-[state=checked]:ring-primary",
            )}
          >
            <span className="flex w-full items-center gap-2">
              {Icon ? (
                <span className={cn("inline-flex size-6 items-center justify-center rounded-full", TONE_CLASS[option.tone ?? "neutral"])}>
                  <Icon aria-hidden className="size-3.5" />
                </span>
              ) : null}
              <span className="flex-1 text-[13px] font-medium text-foreground">{option.title}</span>
              <span
                aria-hidden
                className="inline-flex size-4 items-center justify-center rounded-full border border-border text-primary-foreground group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary"
              >
                <Check className="size-3 opacity-0 group-data-[state=checked]:opacity-100" />
              </span>
            </span>
            {option.description ? <span className="text-xs leading-snug text-muted-foreground">{option.description}</span> : null}
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
              "inline-flex h-7 items-center gap-1 rounded-full border px-3 text-[13px] transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
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
        <Button type="button" variant="outline" onClick={add} disabled={disabled || !draft.trim()} className="rounded-full">
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
            <li key={value} className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-muted pr-1 pl-2.5 font-mono text-xs">
              {renderChip ? renderChip(value) : value}
              <button
                type="button"
                onClick={() => onChange(values.filter((v) => v !== value))}
                aria-label={`Remove ${value}`}
                className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline gap-2">
        {htmlFor ? (
          <label htmlFor={htmlFor} id={id} className="text-xs font-medium text-foreground">
            {label}
          </label>
        ) : (
          <span id={id} className="text-xs font-medium text-foreground">
            {label}
          </span>
        )}
        {required ? <span className="text-[11px] text-muted-foreground">required</span> : null}
      </div>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
