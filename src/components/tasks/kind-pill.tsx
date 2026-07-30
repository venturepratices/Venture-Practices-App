import { StatusPillBase, type StatusTone } from "@/components/ui/status-pill";
import { TASK_KIND_LABELS } from "@/lib/validations/task";

const TASK_KIND_TONES: Record<string, StatusTone> = {
  PROJECT: "violet",
  DIRECT_MAIL: "sky",
  TASK: "neutral",
  OTHER: "slate",
};

export function KindPill({ kind, className }: { kind: string; className?: string }) {
  return <StatusPillBase tone={TASK_KIND_TONES[kind] ?? "neutral"} label={TASK_KIND_LABELS[kind] ?? kind} className={className} />;
}
