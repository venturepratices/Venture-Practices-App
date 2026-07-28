import { z } from "zod";

export const createWorkflowInstanceSchema = z.object({
  workflowTemplateId: z.string().nullable().optional(),
  name: z.string().trim().min(1, "Name is required").max(200),
  clientId: z.string().nullable().optional(),
});

export type CreateWorkflowInstanceInput = z.infer<typeof createWorkflowInstanceSchema>;

// Replaces a live instance's stagesSnapshot — used to add/rename stages on an
// in-flight workflow (blank-started or template-started). Task templates
// aren't part of this: an instance's stages carry live tasks added ad hoc via
// NewTaskInput, not a reusable task list.
export const updateWorkflowInstanceStagesSchema = z.object({
  stages: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Stage name is required").max(200),
        description: z.string().trim().max(2000).nullable().optional(),
      })
    )
    .min(1, "A workflow needs at least one stage"),
});

export type UpdateWorkflowInstanceStagesInput = z.infer<typeof updateWorkflowInstanceStagesSchema>;
