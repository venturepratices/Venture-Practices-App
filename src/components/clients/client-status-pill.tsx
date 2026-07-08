import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = {
  ACTIVE: "Active",
  ONBOARDING: "Onboarding",
  PAUSED: "Paused",
  OFFBOARDED: "Offboarded",
};

const CLASSES: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  ONBOARDING: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  PAUSED: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  OFFBOARDED: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
};

export function ClientStatusPill({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold", CLASSES[status])}>
      {LABELS[status] ?? status}
    </span>
  );
}
