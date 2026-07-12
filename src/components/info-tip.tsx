"use client";

import { HelpCircle } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * A small "?" icon that reveals a helper popup on hover/focus. Drop it next to
 * any title or label that a first-time user might not immediately understand.
 */
export function InfoTip({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          aria-label="What is this?"
          className="inline-flex shrink-0 cursor-help items-center align-middle text-muted-foreground/70 outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
        >
          <HelpCircle className="size-4" />
        </TooltipTrigger>
        <TooltipContent>{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
