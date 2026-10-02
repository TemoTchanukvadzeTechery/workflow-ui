"use client";

import { Sparkles } from "lucide-react";
import { CircleIconButton } from "@/components/common/circle-icon-button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMac } from "@/components/shell/use-is-mac";
import { cn } from "@/lib/utils";
import { toggleAssistant, useAssistantState } from "./assistant-store";
import { useDockWide } from "./assistant-dock";

/** The nav's circle sparkle button: shows or hides the assistant (also Cmd/Ctrl+J). */
export function AssistantButton({ className }: { className?: string }) {
  const isMac = useIsMac();
  const { docked, sheet } = useAssistantState();
  const showing = useDockWide() ? docked : sheet;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <CircleIconButton
          icon={Sparkles}
          label={showing ? "Hide assistant" : "Open assistant"}
          aria-pressed={showing}
          aria-keyshortcuts={isMac ? "Meta+J" : "Control+J"}
          onClick={toggleAssistant}
          className={cn(showing && "raised border-transparent", className)}
        />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Assistant <Kbd>{isMac ? "⌘J" : "Ctrl J"}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}
