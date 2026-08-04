import { z } from "zod";

import { CAMPAIGN_STAGE_VALUES } from "@/lib/campaign-stage";

export const TASK_OCCURRENCE_VALUES = [
  "RECURRING_WEEKLY",
  "RECURRING_MONTHLY",
  "RECURRING_QUARTERLY",
  "PROJECT",
  "NON_RECURRING",
] as const;

export const TASK_OCCURRENCE_LABELS: Record<string, string> = {
  RECURRING_WEEKLY: "Recurring Weekly",
  RECURRING_MONTHLY: "Recurring Monthly",
  RECURRING_QUARTERLY: "Recurring Quarterly",
  PROJECT: "Project",
  NON_RECURRING: "Non Recurring",
};

export const TASK_KIND_VALUES = ["PROJECT", "DIRECT_MAIL", "TASK", "OTHER"] as const;

export const TASK_KIND_LABELS: Record<string, string> = {
  PROJECT: "Project",
  DIRECT_MAIL: "Direct Mail",
  TASK: "Task",
  OTHER: "Other",
};

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  description: z.string().trim().max(4000).nullable().optional(),
  clientId: z.string().nullable().optional(),
  assigneeIds: z.array(z.string()).optional(),
  // Validated against the live TaskStatusOption table inside the route
  // handler, not a fixed enum — admins can add/rename statuses at runtime.
  status: z.string().trim().min(1).optional(),
  occurrence: z.enum(TASK_OCCURRENCE_VALUES).optional(),
  deadline: z.string().datetime().nullable().optional(),
  campaignId: z.string().nullable().optional(),
  campaignStage: z.enum(CAMPAIGN_STAGE_VALUES).nullable().optional(),
  workflowInstanceId: z.string().nullable().optional(),
  workflowStageNumber: z.number().int().nullable().optional(),
  kind: z.enum(TASK_KIND_VALUES).optional(),
  isPrivate: z.boolean().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  assigneeIds: z.array(z.string()).optional(),
  clientId: z.string().nullable().optional(),
  occurrence: z.enum(TASK_OCCURRENCE_VALUES).optional(),
  status: z.string().trim().min(1).optional(),
  deadline: z.string().datetime().nullable().optional(),
  campaignId: z.string().nullable().optional(),
  campaignStage: z.enum(CAMPAIGN_STAGE_VALUES).nullable().optional(),
  workflowInstanceId: z.string().nullable().optional(),
  kind: z.enum(TASK_KIND_VALUES).optional(),
  isPrivate: z.boolean().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
