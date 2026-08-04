import { z } from "zod";

const taskTemplateLinkSchema = z.object({
  url: z.string().trim().min(1, "URL is required").max(2000),
  label: z.string().trim().min(1, "Label is required").max(120),
});

const taskTemplateSchema = z.object({
  title: z.string().trim().min(1, "Task title is required").max(300),
  description: z.string().trim().max(2000).nullable().optional(),
  // A TaskStatusOption id, validated against the live list in the route handler.
  defaultStatus: z.string().trim().min(1),
  defaultAssigneeIds: z.array(z.string()).default([]),
  links: z.array(taskTemplateLinkSchema).default([]),
});

const stageTemplateSchema = z.object({
  name: z.string().trim().min(1, "Stage name is required").max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  taskTemplates: z.array(taskTemplateSchema),
});

export const createWorkflowTemplateSchema = z.object({
  name: z.string().trim().min(1, "Template name is required").max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  stageTemplates: z.array(stageTemplateSchema),
});

export const updateWorkflowTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
  // When provided, replaces the entire stages/tasks tree wholesale — templates
  // are edited infrequently, so a full-tree replace is simpler and safer than
  // granular per-stage/per-task CRUD endpoints. Matches the Direct Mail
  // ProgramTemplate PATCH convention exactly.
  stageTemplates: z.array(stageTemplateSchema).optional(),
});

export type TaskTemplateInput = z.infer<typeof taskTemplateSchema>;
export type StageTemplateInput = z.infer<typeof stageTemplateSchema>;
export type CreateWorkflowTemplateInput = z.infer<typeof createWorkflowTemplateSchema>;
export type UpdateWorkflowTemplateInput = z.infer<typeof updateWorkflowTemplateSchema>;
