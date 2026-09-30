"use client";

import type { ElementType } from "react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsTruncated } from "@/lib/use-is-truncated";
import { cn } from "@/lib/utils";

/**
 * A single line of `text` that clips with an ellipsis when its container is
 * too narrow — hovering a clipped line pops up the full text immediately
 * (no delay, unlike InfoTip's 150ms: this is revealing text that's already
 * on screen, not explaining something unfamiliar). A line that isn't
 * actually clipped renders with no tooltip at all, checked live so a
 * column-resize or window-resize keeps it accurate.
 *
 * `as` defaults to "span" — pass "p" or "div" when the call site needs the
 * element to stay block-level (e.g. stacked title/description lines) rather
 * than adding a "block" class every time.
 */
export function TruncateTooltip({
  text,
  className,
  as = "span",
}: {
  text: string;
  className?: string;
  as?: ElementType;
}) {
  const Comp = as;
  const { ref, truncated } = useIsTruncated<HTMLElement>();
  const line = (
    <Comp ref={ref} className={cn("truncate", className)}>
      {text}
    </Comp>
  );

  if (!truncated) return line;

  return (
    <TooltipProvider delay={0}>
      <Tooltip>
        <TooltipTrigger render={line} />
        <TooltipContent side="top" align="start">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
