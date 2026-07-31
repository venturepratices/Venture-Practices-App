import { StatusPillBase, type StatusTone } from "@/components/ui/status-pill";
import { PLANNING_STATUS_LABELS } from "@/lib/validations/planning";

const PLANNING_STATUS_TONES: Record<string, StatusTone> = {
  IDEA: "sky",
  STRATEGY: "violet",
  CONVERTED: "success",
  ARCHIVED: "slate",
};

export function PlanningStatusPill({ status, className }: { status: string; className?: string }) {
  return <StatusPillBase tone={PLANNING_STATUS_TONES[status] ?? "neutral"} label={PLANNING_STATUS_LABELS[status] ?? status} className={className} />;
}
