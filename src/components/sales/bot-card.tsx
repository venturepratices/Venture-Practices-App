import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Shared look for the Bots screen: the same card, header and touch sizes as
// the other Sales settings screens.

export const CARD = "rounded-[12px] border bg-card shadow-sm";
const CARD_HEAD =
  "flex flex-wrap items-center gap-2 border-b px-4 py-3 text-[14px] font-semibold text-foreground [&>svg]:size-4 [&>svg]:text-muted-foreground";
export const BODY = "px-4 py-3 text-[13.5px] leading-snug";
/** Buttons and fields are 44px tall on touch screens. */
export const TOUCH = "pointer-coarse:min-h-11";
export const MUTED = "text-[12.5px] text-muted-foreground";
export const WARN = "rounded-[10px] bg-amber-100 px-3 py-2 text-[13px] text-amber-950 dark:bg-amber-950/60 dark:text-amber-100";
export const NOTE = "rounded-[10px] bg-accent px-3 py-2.5 text-[13px] text-accent-foreground";

export function CardHeader({
  icon: Icon,
  children,
  action,
  id,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  action?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className={CARD_HEAD}>
      <Icon aria-hidden="true" />
      <h2 id={id} className="m-0 text-[14px] font-semibold">
        {children}
      </h2>
      {action ? <div className={cn("ml-auto")}>{action}</div> : null}
    </div>
  );
}
