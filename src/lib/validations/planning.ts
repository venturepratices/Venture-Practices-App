import { z } from "zod";

export const PLANNING_STATUS_VALUES = ["IDEA", "STRATEGY", "CONVERTED", "ARCHIVED"] as const;

export const PLANNING_STATUS_LABELS: Record<string, string> = {
  IDEA: "Idea",
  STRATEGY: "Strategy",
  CONVERTED: "Converted",
  ARCHIVED: "Archived",
};

export const createPlanningItemSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  description: z.string().trim().max(4000).nullable().optional(),
  // Only the two real starting points make sense at creation time — moving to
  // a task or archiving is a deliberate action taken later, not a way to add one.
  status: z.enum(["IDEA", "STRATEGY"]).optional(),
});

export const updatePlanningItemSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  // CONVERTED is never settable directly here — only the convert route can
  // move an item into that status, since it also has to create the real task.
  status: z.enum(["IDEA", "STRATEGY", "ARCHIVED"]).optional(),
});

export const convertPlanningItemSchema = z.object({
  assigneeIds: z.array(z.string()).min(1, "Assign this to at least one person to turn it into a task."),
});
