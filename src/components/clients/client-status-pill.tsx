import { StatusPillBase, type StatusTone } from "@/components/ui/status-pill";

const LABELS: Record<string, string> = {
  ACTIVE: "Active",
  ONBOARDING: "Onboarding",
  PAUSED: "Paused",
  OFFBOARDED: "Offboarded",
};

const TONES: Record<string, StatusTone> = {
  ACTIVE: "success",
  ONBOARDING: "sky",
  PAUSED: "warning",
  OFFBOARDED: "neutral",
};

export function ClientStatusPill({ status }: { status: string }) {
  return <StatusPillBase tone={TONES[status]} label={LABELS[status] ?? status} />;
}
