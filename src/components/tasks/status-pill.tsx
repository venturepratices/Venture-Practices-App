import { cn } from "@/lib/utils";

export const TASK_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  IN_PROGRESS: "In Progress",
  PRIORITY: "Priority",
  NEXT_UP: "Next-Up",
  WAITING_ON_CLIENT: "Waiting on Client",
  ON_HOLD: "On Hold",
  COMPLETE: "Complete",
};

const STATUS_CLASSES: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  IN_PROGRESS: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  PRIORITY: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  NEXT_UP: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  WAITING_ON_CLIENT: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  ON_HOLD: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
  COMPLETE: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold",
        STATUS_CLASSES[status],
        className
      )}
    >
      {TASK_STATUS_LABELS[status] ?? status}
    </span>
  );
}
