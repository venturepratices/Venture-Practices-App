import { StatusPillBase, type StatusTone } from "@/components/ui/status-pill";

// Renders from a resolved TaskStatusOption (or an equivalent {label, tone}
// shape) instead of looking a status key up in a static map — the set of
// statuses is now admin-editable (see TaskStatusOption in prisma/schema.prisma
// and src/lib/task-status.ts), so there's no fixed key set left to map from.
export function StatusPill({
  option,
  className,
}: {
  option: { label: string; tone: string; color?: string | null };
  className?: string;
}) {
  return (
    <StatusPillBase tone={option.tone as StatusTone} color={option.color} label={option.label} className={className} />
  );
}
