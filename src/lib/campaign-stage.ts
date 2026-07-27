import type { StatusTone } from "@/components/ui/status-pill";

export const CAMPAIGN_STAGE_VALUES = [
  "PLANNING",
  "CREATIVE",
  "REVIEW",
  "APPROVAL",
  "PRODUCTION",
  "MAILED",
  "RESULTS",
] as const;

export type CampaignStageValue = (typeof CAMPAIGN_STAGE_VALUES)[number];

export const CAMPAIGN_STAGE_LABELS: Record<CampaignStageValue, string> = {
  PLANNING: "Planning",
  CREATIVE: "Creative",
  REVIEW: "Review",
  APPROVAL: "Approval",
  PRODUCTION: "Production",
  MAILED: "Mailed",
  RESULTS: "Results",
};

export const CAMPAIGN_STAGE_TONES: Record<CampaignStageValue, StatusTone> = {
  PLANNING: "slate",
  CREATIVE: "violet",
  REVIEW: "blue",
  APPROVAL: "warning",
  PRODUCTION: "sky",
  MAILED: "teal",
  RESULTS: "success",
};

/** Next stage in the fixed pipeline order, or null once at RESULTS (the end). */
export function nextCampaignStage(stage: CampaignStageValue): CampaignStageValue | null {
  const index = CAMPAIGN_STAGE_VALUES.indexOf(stage);
  return index === -1 || index === CAMPAIGN_STAGE_VALUES.length - 1 ? null : CAMPAIGN_STAGE_VALUES[index + 1];
}

/** Prefers the campaign's own name; falls back to "Campaign #N" when unnamed. */
export function campaignLabel(campaign: { name?: string | null; sequenceNumber: number }): string {
  return campaign.name?.trim() || `Campaign #${campaign.sequenceNumber}`;
}
