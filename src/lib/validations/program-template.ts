import { z } from "zod";

import { CAMPAIGN_STAGE_VALUES } from "@/lib/campaign-stage";
import { ROLE_TAG_VALUES } from "@/lib/role-tag";

const taskTemplateSchema = z.object({
  title: z.string().trim().min(1, "Task title is required").max(300),
  roleTag: z.enum(ROLE_TAG_VALUES),
  daysBeforeMailDate: z.coerce.number().int().nullable().optional(),
});

const stageTemplateSchema = z.object({
  stage: z.enum(CAMPAIGN_STAGE_VALUES),
  tasks: z.array(taskTemplateSchema),
});

export const createProgramTemplateSchema = z.object({
  name: z.string().trim().min(1, "Template name is required").max(120),
  stages: z.array(stageTemplateSchema),
});

export const updateProgramTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
  // When provided, replaces the entire stages/tasks tree wholesale — templates
  // are edited infrequently by admins, so a full-tree replace is simpler and
  // safer than granular per-stage/per-task CRUD endpoints.
  stages: z.array(stageTemplateSchema).optional(),
});

export type TaskTemplateInput = z.infer<typeof taskTemplateSchema>;
export type StageTemplateInput = z.infer<typeof stageTemplateSchema>;
export type CreateProgramTemplateInput = z.infer<typeof createProgramTemplateSchema>;
export type UpdateProgramTemplateInput = z.infer<typeof updateProgramTemplateSchema>;
