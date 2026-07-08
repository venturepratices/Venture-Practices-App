import { z } from "zod";

export const CLIENT_STATUS_VALUES = ["ACTIVE", "ONBOARDING", "PAUSED", "OFFBOARDED"] as const;

export const clientSchema = z.object({
  name: z.string().trim().min(1, "Client name is required").max(120),
  status: z.enum(CLIENT_STATUS_VALUES),
});

export type ClientInput = z.infer<typeof clientSchema>;
