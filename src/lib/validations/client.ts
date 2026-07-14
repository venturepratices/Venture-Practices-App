import { z } from "zod";

export const CLIENT_STATUS_VALUES = ["ACTIVE", "ONBOARDING", "PAUSED", "OFFBOARDED"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));

export const clientSchema = z.object({
  name: z.string().trim().min(1, "Client name is required").max(120),
  status: z.enum(CLIENT_STATUS_VALUES),
  contactName: optionalText(120),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email")
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
  contactPhone: optionalText(40),
  website: z
    .string()
    .trim()
    .url("Enter a valid URL")
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
  address: optionalText(300),
  about: optionalText(4000),
});

export type ClientInput = z.infer<typeof clientSchema>;
