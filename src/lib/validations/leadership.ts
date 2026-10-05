import { z } from "zod";

const issueKind = z.enum(["PROBLEM", "SITUATION"]);

export const createIssueSchema = z.union([
  z.object({
    title: z.string().trim().min(1, "Title is required").max(300),
    description: z.string().trim().max(8000).nullable().optional(),
    kind: issueKind.optional(),
    clientId: z.string().nullable().optional(),
  }),
  // Brain-dump paste: many titles at once, one issue each.
  z.object({
    titles: z.array(z.string().trim().min(1).max(300)).min(1, "Nothing to add").max(100),
    kind: issueKind.optional(),
  }),
]);

export const updateIssueSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(8000).nullable().optional(),
  kind: issueKind.optional(),
  status: z.enum(["OPEN", "SOLVED"]).optional(),
  // 1–3 puts it in this week's Top 3; null takes it out.
  topRank: z.number().int().min(1).max(3).nullable().optional(),
  clientId: z.string().nullable().optional(),
});

export const createRecommendationSchema = z.object({
  body: z.string().trim().min(1, "Write a recommendation first").max(4000),
});

export const updateRecommendationSchema = z.object({
  isDecision: z.boolean(),
});

export const issueToTaskSchema = z.object({
  assigneeIds: z.array(z.string()).min(1, "Assign this to at least one person to turn it into a task."),
  // "YYYY-MM-DD" — defaults to one week out in the dialog.
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a due date"),
});

export const issueToRockSchema = z.object({
  ownerId: z.string().min(1, "Pick an owner"),
  isCompany: z.boolean().optional(),
});

const rockStatus = z.enum(["ON_TRACK", "OFF_TRACK", "DONE"]);

export const createRockSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  doneDefinition: z.string().trim().max(4000).nullable().optional(),
  ownerId: z.string().min(1, "Pick an owner"),
  isCompany: z.boolean().optional(),
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const updateRockSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  doneDefinition: z.string().trim().max(4000).nullable().optional(),
  ownerId: z.string().nullable().optional(),
  isCompany: z.boolean().optional(),
  status: rockStatus.optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
