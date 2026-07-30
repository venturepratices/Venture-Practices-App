import { StatusPillBase, type StatusTone } from "@/components/ui/status-pill";
import { TASK_KIND_LABELS } from "@/lib/validations/task";

const TASK_KIND_TONES: Record<string, StatusTone> = {
  PROJECT: "violet",
  DIRECT_MAIL: "sky",
  TASK: "neutral",
  OTHER: "slate",
};

// `label` overrides the generic kind name — used to show the specific
// project a task is under (e.g. "Journey Smiles Onboarding") instead of just
// the generic "Project" category, once one has been picked.
export function KindPill({ kind, label, className }: { kind: string; label?: string | null; className?: string }) {
  return <StatusPillBase tone={TASK_KIND_TONES[kind] ?? "neutral"} label={label ?? TASK_KIND_LABELS[kind] ?? kind} className={className} />;
}
