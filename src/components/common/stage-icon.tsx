import { BadgeCheck, CodeXml, FileText, FlaskConical, Network, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StageDef, StageId } from "@/lib/delivery/types";

/** SPEC 5.3 stage icons. Stages have no color of their own; color always means status. */
export const STAGE_ICONS: Record<StageId, LucideIcon> = {
  requirements: FileText,
  architecture: Network,
  implementation: CodeXml,
  qa: FlaskConical,
  signoff: BadgeCheck,
};

/** Same mapping keyed by StageDef.icon names, for code that only has the def. */
export const STAGE_ICON_BY_NAME: Record<StageDef["icon"], LucideIcon> = {
  FileText,
  Network,
  Code2: CodeXml,
  FlaskConical,
  BadgeCheck,
};

export interface StageIconProps {
  stage: StageId;
  className?: string;
  strokeWidth?: number;
}

export function StageIcon({ stage, className, strokeWidth = 1.75 }: StageIconProps) {
  const Icon = STAGE_ICONS[stage] ?? FileText;
  return <Icon aria-hidden className={cn("size-4 shrink-0", className)} strokeWidth={strokeWidth} />;
}
