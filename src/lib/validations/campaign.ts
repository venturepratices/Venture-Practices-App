import { z } from "zod";

import { CAMPAIGN_STAGE_VALUES } from "@/lib/campaign-stage";

export const createCampaignSchema = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  mailDate: z.string().datetime().nullable().optional(),
  quantity: z.coerce.number().int().min(0).nullable().optional(),
  geography: z.string().trim().max(300).nullable().optional(),
  budgetCents: z.coerce.number().int().min(0).nullable().optional(),
  offer: z.string().trim().max(300).nullable().optional(),
  cta: z.string().trim().max(300).nullable().optional(),
});

export const updateCampaignSchema = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  mailDate: z.string().datetime().nullable().optional(),
  creativeDueDate: z.string().datetime().nullable().optional(),
  approvalDueDate: z.string().datetime().nullable().optional(),
  printDueDate: z.string().datetime().nullable().optional(),
  currentStage: z.enum(CAMPAIGN_STAGE_VALUES).optional(),
  quantity: z.coerce.number().int().min(0).nullable().optional(),
  geography: z.string().trim().max(300).nullable().optional(),
  budgetCents: z.coerce.number().int().min(0).nullable().optional(),
  offer: z.string().trim().max(300).nullable().optional(),
  cta: z.string().trim().max(300).nullable().optional(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

// The Campaign Generator wizard — batch-creates several campaigns at once
// for a client (e.g. 6 monthly mailings), optionally seeded from a template.
export const createCampaignWizardSchema = z.object({
  clientId: z.string(),
  templateId: z.string().nullable(),
  startMonth: z.string().datetime(),
  lengthMonths: z.coerce.number().int().min(1).max(36),
  mailDayOfMonth: z.coerce.number().int().min(1).max(28),
  quantity: z.coerce.number().int().min(0).nullable(),
  budgetCents: z.coerce.number().int().min(0).nullable(),
  geography: z.string().trim().max(300).nullable(),
  offer: z.string().trim().max(300).nullable(),
  cta: z.string().trim().max(300).nullable(),
});

export type CreateCampaignWizardInput = z.infer<typeof createCampaignWizardSchema>;
