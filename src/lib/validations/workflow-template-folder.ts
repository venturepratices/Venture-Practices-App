import { z } from "zod";

export const createWorkflowTemplateFolderSchema = z.object({
  name: z.string().trim().min(1, "Folder name is required").max(80),
  color: z.string().trim().max(32).nullable().optional(),
});

export const updateWorkflowTemplateFolderSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  color: z.string().trim().max(32).nullable().optional(),
});
