import { StageIcon } from "@/components/common";
import { stageDef, type StageId } from "@/lib/delivery/types";
import { cn } from "@/lib/utils";

export interface StageChipProps {
  stage: StageId;
  /** Show "3 ·" before the title. */
  numbered?: boolean;
  /** Use the short label ("BRD", "AAD", "Build", "QA", "Sign-off"). */
  short?: boolean;
  className?: string;
}

/** Stage identity chip: icon + title in a well pill. Stages have no color; color means status. */
export function StageChip({ stage, numbered, short, className }: StageChipProps) {
  const def = stageDef(stage);
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-full bg-well px-2 text-xs leading-none whitespace-nowrap text-muted-foreground",
        className,
      )}
      title={`Stage ${def.n}: ${def.title}`}
    >
      <StageIcon stage={stage} className="size-3.5" />
      {numbered ? <span className="font-mono tabular-nums">{def.n}</span> : null}
      <span className="truncate">{short ? def.short : def.title}</span>
    </span>
  );
}
