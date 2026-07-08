import { z } from "zod";

export const createTeamMemberSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const updateTeamMemberSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.union([z.string().min(8, "Password must be at least 8 characters"), z.literal("")]).optional(),
});
