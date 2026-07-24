import { StatusPillBase, type StatusTone } from "@/components/ui/status-pill";

export const TASK_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  IN_PROGRESS: "In Progress",
  PRIORITY: "Priority",
  NEXT_UP: "Next-Up",
  WAITING_ON_CLIENT: "Waiting on Client",
  ON_HOLD: "On Hold",
  COMPLETE: "Complete",
};

export const TASK_STATUS_TONES: Record<string, StatusTone> = {
  ACTIVE: "success",
  IN_PROGRESS: "blue",
  PRIORITY: "danger",
  NEXT_UP: "violet",
  WAITING_ON_CLIENT: "warning",
  ON_HOLD: "neutral",
  COMPLETE: "teal",
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <StatusPillBase
      tone={TASK_STATUS_TONES[status]}
      label={TASK_STATUS_LABELS[status] ?? status}
      className={className}
    />
  );
}
