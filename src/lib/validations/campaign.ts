import { z } from "zod";

import { CAMPAIGN_STAGE_VALUES } from "@/lib/campaign-stage";

export const createCampaignSchema = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  mailDate: z.string().datetime(),
  quantity: z.coerce.number().int().min(0).nullable().optional(),
  geography: z.string().trim().max(300).nullable().optional(),
  budgetCents: z.coerce.number().int().min(0).nullable().optional(),
  offer: z.string().trim().max(300).nullable().optional(),
  cta: z.string().trim().max(300).nullable().optional(),
});

export const updateCampaignSchema = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  mailDate: z.string().datetime().optional(),
  creativeDueDate: z.string().datetime().optional(),
  approvalDueDate: z.string().datetime().optional(),
  printDueDate: z.string().datetime().optional(),
  currentStage: z.enum(CAMPAIGN_STAGE_VALUES).optional(),
  quantity: z.coerce.number().int().min(0).nullable().optional(),
  geography: z.string().trim().max(300).nullable().optional(),
  budgetCents: z.coerce.number().int().min(0).nullable().optional(),
  offer: z.string().trim().max(300).nullable().optional(),
  cta: z.string().trim().max(300).nullable().optional(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
