import { StatusPillBase } from "@/components/ui/status-pill";

// Same rendering primitive as StatusPill, always rendered from a literal hex
// color (priority levels have no fixed-tone equivalent — see
// PriorityLevelOption in prisma/schema.prisma).
export function PriorityPill({
  option,
  className,
}: {
  option: { label: string; color: string };
  className?: string;
}) {
  return <StatusPillBase tone="neutral" color={option.color} label={option.label} className={className} />;
}
