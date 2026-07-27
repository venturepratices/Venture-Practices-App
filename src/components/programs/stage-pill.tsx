import { StatusPillBase } from "@/components/ui/status-pill";
import { CAMPAIGN_STAGE_LABELS, CAMPAIGN_STAGE_TONES, type CampaignStageValue } from "@/lib/campaign-stage";

export function StagePill({ stage, className }: { stage: string; className?: string }) {
  return (
    <StatusPillBase
      tone={CAMPAIGN_STAGE_TONES[stage as CampaignStageValue]}
      label={CAMPAIGN_STAGE_LABELS[stage as CampaignStageValue] ?? stage}
      className={className}
    />
  );
}
