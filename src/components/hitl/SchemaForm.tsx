"use client";

/**
 * The generic answer form: one control per schema property, chosen by schemaQuestions (the weft
 * port in src/lib/weft/schema-form.ts). Controlled: the parent holds the values and posts
 * buildAnswer(schema, values). Used for any request without a bespoke form.
 */
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { schemaQuestions, type SchemaFormValues, type SchemaQuestion } from "@/lib/weft/schema-form";
import type { HumanKind, JsonSchema } from "@/lib/weft/types";
import { cn } from "@/lib/utils";
import { ChipToggles, OptionCards, PillChoice } from "./controls";

export interface SchemaFormProps {
  schema: JsonSchema | null | undefined;
  /** Deniable kinds hide the `approved` field (the buttons are the verdict). */
  kind?: HumanKind;
  values: SchemaFormValues;
  onChange: (values: SchemaFormValues) => void;
  /** Keys a surrounding form renders itself. */
  omit?: readonly string[];
  disabled?: boolean;
  className?: string;
}

function typeLabel(q: SchemaQuestion): string {
  const t = (q.property as { type?: unknown }).type;
  const type = Array.isArray(t) ? t.filter((x) => x !== "null").join(" / ") : typeof t === "string" ? t : "value";
  return [type, q.required ? "required" : "optional"].join(" · ");
}

function Field({ q, value, set, disabled }: { q: SchemaQuestion; value: unknown; set: (v: unknown) => void; disabled?: boolean }) {
  const id = useId();
  const labelId = `${id}-label`;
  const descId = q.description ? `${id}-desc` : undefined;
  const str = typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
  const prop = q.property as { minimum?: number; maximum?: number };

  let control: React.ReactNode;
  switch (q.control) {
    case "toggle":
      control = (
        <div className="flex items-center gap-2">
          <Switch id={id} checked={value === true} onCheckedChange={(c) => set(c)} disabled={disabled} aria-describedby={descId} />
          <span className="text-[13px] text-muted-foreground">{value === true ? "on" : "off"}</span>
        </div>
      );
      break;
    case "cards":
      control = (
        <OptionCards
          value={str}
          onChange={set}
          ariaLabelledBy={labelId}
          disabled={disabled}
          options={q.options.map((o) => ({ value: o.value, title: o.label, description: o.description || undefined }))}
        />
      );
      break;
    case "choice":
      control = <PillChoice value={str} onChange={set} ariaLabelledBy={labelId} disabled={disabled} options={q.options.map((o) => ({ value: o.value, label: o.label }))} />;
      break;
    case "chips":
      control = <ChipToggles values={Array.isArray(value) ? value.map(String) : []} onChange={set} ariaLabel={q.label} options={q.options.map((o) => ({ value: o.value, label: o.label }))} />;
      break;
    case "select":
      control = (
        <Select value={str || undefined} onValueChange={set} disabled={disabled}>
          <SelectTrigger id={id} className="min-w-48" aria-labelledby={labelId} aria-describedby={descId}>
            <SelectValue placeholder={q.required ? "Choose one" : "Optional"} />
          </SelectTrigger>
          <SelectContent>
            {q.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case "list":
      control = (
        <Textarea
          id={id}
          rows={3}
          value={Array.isArray(value) ? value.join("\n") : str}
          onChange={(e) => set(e.target.value)}
          placeholder="One item per line"
          disabled={disabled}
          aria-describedby={descId}
          className="font-mono text-[13px]"
        />
      );
      break;
    case "note":
      control = <Textarea id={id} rows={3} value={str} onChange={(e) => set(e.target.value)} placeholder={q.required ? "Required" : "Optional"} disabled={disabled} aria-describedby={descId} />;
      break;
    case "number":
      control = (
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          value={str}
          min={prop.minimum}
          max={prop.maximum}
          onChange={(e) => set(e.target.value)}
          placeholder={q.required ? "Required" : "Optional"}
          disabled={disabled}
          aria-describedby={descId}
          className="w-40"
        />
      );
      break;
    default:
      control = <Input id={id} value={str} onChange={(e) => set(e.target.value)} placeholder={q.required ? "Required" : "Optional"} disabled={disabled} aria-describedby={descId} />;
  }

  const labelFor = q.control === "cards" || q.control === "choice" || q.control === "chips" ? undefined : id;
  return (
    <div className="grid gap-1.5 @lg:grid-cols-[10rem_1fr] @lg:gap-4">
      <div className="pt-1.5">
        {labelFor ? (
          <label id={labelId} htmlFor={labelFor} className="block text-[13px] font-medium">
            {q.label}
          </label>
        ) : (
          <span id={labelId} className="block text-[13px] font-medium">
            {q.label}
          </span>
        )}
        <span className="font-mono text-[11px] text-muted-foreground">{typeLabel(q)}</span>
      </div>
      <div className="min-w-0 space-y-1">
        {control}
        {q.description ? (
          <p id={descId} className="text-xs text-muted-foreground">
            {q.description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function SchemaForm({ schema, kind, values, onChange, omit, disabled, className }: SchemaFormProps) {
  const questions = schemaQuestions(schema, { kind, omit });
  if (questions.length === 0) {
    return <p className={cn("text-[13px] text-muted-foreground", className)}>This question declares no fields; answering it just releases the run.</p>;
  }
  return (
    <div className={cn("space-y-4", className)}>
      {questions.map((q) => (
        <Field key={q.key} q={q} value={values[q.key]} set={(v) => onChange({ ...values, [q.key]: v })} disabled={disabled} />
      ))}
    </div>
  );
}
