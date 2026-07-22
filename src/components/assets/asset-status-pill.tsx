import { cn } from "@/lib/utils";

/**
 * Colored pill for AssetStatus — mirrors the visual language of
 * status-pill.tsx (Task) and client-status-pill.tsx (Client).
 */
const STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  IN_REVIEW: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  CHANGES_REQUESTED: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  ARCHIVED: "bg-muted text-muted-foreground",
};

const LABELS: Record<string, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In review",
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  ARCHIVED: "Archived",
};

export function AssetStatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STYLES[status] ?? "bg-muted text-muted-foreground",
        className
      )}
    >
      {LABELS[status] ?? status}
    </span>
  );
}
