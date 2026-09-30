"use client";

/** Search + stage / health / attention / done filters and the table-card toggle for /projects. */
import { Hand, HeartPulse, Layers3, LayoutGrid, Rows3, Search, X } from "lucide-react";
import { useId } from "react";
import { SegmentedControl, ToolbarGroup } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { STAGES, type Health, type ProjectSummary, type StageId } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";
import { healthMeta } from "@/lib/weft/labels";

export type ProjectsViewMode = "table" | "cards";

export interface ProjectFilterState {
  q: string;
  stage: StageId | "all";
  health: Health | "all";
  attention: boolean;
  includeDone: boolean;
}

export const EMPTY_FILTERS: ProjectFilterState = { q: "", stage: "all", health: "all", attention: false, includeDone: false };

export function isFiltered(f: ProjectFilterState): boolean {
  return f.q.trim() !== "" || f.stage !== "all" || f.health !== "all" || f.attention;
}

export function applyFilters(rows: ProjectSummary[], f: ProjectFilterState): ProjectSummary[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((p) => {
    if (!f.includeDone && p.done) return false;
    if (f.stage !== "all" && (p.done || p.currentStage !== f.stage)) return false;
    if (f.health !== "all" && p.health !== f.health) return false;
    if (f.attention && p.waitingCount === 0) return false;
    if (q && ![p.name, p.key, p.id, p.summary, p.nextStep ?? ""].some((s) => s.toLowerCase().includes(q))) return false;
    return true;
  });
}

const HEALTHS: Health[] = ["on_track", "at_risk", "off_track"];

export interface ProjectFiltersProps {
  value: ProjectFilterState;
  onChange: (next: ProjectFilterState) => void;
  view: ProjectsViewMode;
  onViewChange: (view: ProjectsViewMode) => void;
  className?: string;
}

export function ProjectFilters({ value, onChange, view, onViewChange, className }: ProjectFiltersProps) {
  const searchId = useId();
  const doneId = useId();
  const set = (patch: Partial<ProjectFilterState>) => onChange({ ...value, ...patch });

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} role="search" aria-label="Filter projects">
      {/* Wide enough for the whole placeholder ("…or next step" was clipped at 16rem). */}
      <div className="relative w-full sm:w-80">
        <label htmlFor={searchId} className="sr-only">
          Search projects
        </label>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
        <Input id={searchId} type="search" value={value.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search name, key or next step" className="pl-10" />
      </div>

      <ToolbarGroup aria-label="Stage and health">
        <Select value={value.stage} onValueChange={(v) => set({ stage: v as ProjectFilterState["stage"] })}>
          <SelectTrigger aria-label="Stage" size="sm">
            <Layers3 aria-hidden className="size-4 text-heading" strokeWidth={1.75} />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {STAGES.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.n}. {s.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={value.health} onValueChange={(v) => set({ health: v as ProjectFilterState["health"] })}>
          <SelectTrigger aria-label="Health" size="sm">
            <HeartPulse aria-hidden className="size-4 text-heading" strokeWidth={1.75} />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any health</SelectItem>
            {HEALTHS.map((h) => (
              <SelectItem key={h} value={h}>
                {healthMeta(h).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ToolbarGroup>

      <Toggle
        pressed={value.attention}
        onPressedChange={(attention) => set({ attention })}
        className="h-11 rounded-[16px] bg-well px-3.5 font-normal text-heading hover:bg-well-hover data-[state=on]:bg-status-attention-bg data-[state=on]:text-status-attention-fg"
      >
        <Hand aria-hidden strokeWidth={1.75} />
        Needs attention
      </Toggle>

      <div className="flex h-11 items-center gap-2.5 rounded-[16px] bg-well px-3.5">
        <Switch id={doneId} checked={value.includeDone} onCheckedChange={(includeDone) => set({ includeDone })} />
        <label htmlFor={doneId} className="text-sm whitespace-nowrap text-heading">
          Include done
        </label>
      </div>

      {isFiltered(value) ? (
        <Button variant="ghost" className="h-11 text-muted-foreground" onClick={() => onChange({ ...EMPTY_FILTERS, includeDone: value.includeDone })}>
          <X aria-hidden />
          Clear
        </Button>
      ) : null}

      <span className="flex-1" />

      <SegmentedControl
        aria-label="Layout"
        value={view}
        onValueChange={onViewChange}
        className="hidden sm:inline-flex"
        items={[
          { value: "table", label: "Table", icon: Rows3 },
          { value: "cards", label: "Cards", icon: LayoutGrid },
        ]}
      />
    </div>
  );
}
