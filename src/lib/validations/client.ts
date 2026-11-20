import { z } from "zod";

export const CLIENT_STATUS_VALUES = ["ACTIVE", "ONBOARDING", "PAUSED", "OFFBOARDED"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));

// What the account manager picker sends for "not assigned". It can never clash
// with a real team member id (those are long random strings).
export const NO_ACCOUNT_MANAGER = "none";

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
  secondaryContactName: optionalText(120),
  secondaryContactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email")
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
  secondaryContactPhone: optionalText(40),
  website: z
    .string()
    .trim()
    .url("Enter a valid URL")
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
  address: optionalText(300),
  about: optionalText(4000),
  source: optionalText(120),
  slackChannelId: optionalText(20),
  // undefined = the form did not send the field, so the stored account manager
  // is left alone. null = "not assigned". A string = the team member's id.
  accountManagerId: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((value) => (value === undefined ? undefined : value && value !== NO_ACCOUNT_MANAGER ? value : null)),
});

export type ClientInput = z.infer<typeof clientSchema>;
