import { z } from "zod";

export const createWorkflowInstanceSchema = z.object({
  workflowTemplateId: z.string().min(1, "Template is required"),
  name: z.string().trim().min(1, "Name is required").max(200),
  clientId: z.string().nullable().optional(),
});

export type CreateWorkflowInstanceInput = z.infer<typeof createWorkflowInstanceSchema>;
