import { z } from "zod";

import { PROGRAM_PRODUCT_VALUES } from "@/lib/validations/program";

export const createProgramWizardSchema = z.object({
  clientId: z.string(),
  templateId: z.string().nullable(),
  name: z.string().trim().min(1, "Program name is required").max(120),
  product: z.enum(PROGRAM_PRODUCT_VALUES),
  startMonth: z.string().datetime(),
  lengthMonths: z.coerce.number().int().min(1).max(36),
  mailDayOfMonth: z.coerce.number().int().min(1).max(28),
  quantity: z.coerce.number().int().min(0).nullable(),
  budgetCents: z.coerce.number().int().min(0).nullable(),
  geography: z.string().trim().max(300).nullable(),
  offer: z.string().trim().max(300).nullable(),
  cta: z.string().trim().max(300).nullable(),
});

export type CreateProgramWizardInput = z.infer<typeof createProgramWizardSchema>;
