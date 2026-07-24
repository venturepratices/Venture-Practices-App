import { StatusPillBase, type StatusTone } from "@/components/ui/status-pill";

const TONES: Record<string, StatusTone> = {
  DRAFT: "slate",
  IN_REVIEW: "warning",
  APPROVED: "success",
  CHANGES_REQUESTED: "danger",
  ARCHIVED: "neutral",
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
    <StatusPillBase tone={TONES[status] ?? "neutral"} label={LABELS[status] ?? status} className={className} />
  );
}
