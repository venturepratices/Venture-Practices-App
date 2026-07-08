import { z } from "zod";

export const TASK_OCCURRENCE_VALUES = [
  "RECURRING_WEEKLY",
  "RECURRING_MONTHLY",
  "RECURRING_QUARTERLY",
  "PROJECT",
  "NON_RECURRING",
] as const;

export const TASK_STATUS_VALUES = [
  "ACTIVE",
  "IN_PROGRESS",
  "PRIORITY",
  "NEXT_UP",
  "WAITING_ON_CLIENT",
  "ON_HOLD",
  "COMPLETE",
] as const;

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  clientId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  assigneeId: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  occurrence: z.enum(TASK_OCCURRENCE_VALUES).optional(),
  status: z.enum(TASK_STATUS_VALUES).optional(),
  deadline: z.string().datetime().nullable().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
