import { z } from "zod";

import type { StatusTone } from "@/components/ui/status-pill";

export const PROGRAM_STATUS_VALUES = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"] as const;

export const PROGRAM_PRODUCT_VALUES = [
  "NEW_MOVERS",
  "EDDM",
  "INVITATION",
  "REACTIVATION",
  "RECALL",
  "OTHER",
] as const;

export const PROGRAM_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  PAUSED: "Paused",
  COMPLETED: "Completed",
};

export const PROGRAM_PRODUCT_LABELS: Record<string, string> = {
  NEW_MOVERS: "New Movers",
  EDDM: "EDDM",
  INVITATION: "Invitation",
  REACTIVATION: "Reactivation",
  RECALL: "Recall",
  OTHER: "Other",
};

export const PROGRAM_STATUS_TONES: Record<string, StatusTone> = {
  DRAFT: "slate",
  ACTIVE: "success",
  PAUSED: "warning",
  COMPLETED: "teal",
};

export const createProgramSchema = z.object({
  name: z.string().trim().min(1, "Program name is required").max(120),
  product: z.enum(PROGRAM_PRODUCT_VALUES).optional(),
  status: z.enum(PROGRAM_STATUS_VALUES).optional(),
  startMonth: z.string().datetime(),
  lengthMonths: z.coerce.number().int().min(1).max(36).optional(),
  accountManagerId: z.string().nullable().optional(),
});

export const updateProgramSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  product: z.enum(PROGRAM_PRODUCT_VALUES).optional(),
  status: z.enum(PROGRAM_STATUS_VALUES).optional(),
  startMonth: z.string().datetime().optional(),
  lengthMonths: z.coerce.number().int().min(1).max(36).optional(),
  accountManagerId: z.string().nullable().optional(),
});

export type CreateProgramInput = z.infer<typeof createProgramSchema>;
export type UpdateProgramInput = z.infer<typeof updateProgramSchema>;
