import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

// Deliberately permissive (no .email()/.url() validation) — a client
// pasting a bare domain or partial info while filling this in over time
// shouldn't hard-fail a partial save.
export const clientIntakeSchema = z.object({
  // Existing Client fields the client may edit directly via the portal.
  contactName: optionalText(120),
  contactEmail: optionalText(200),
  contactPhone: optionalText(40),
  website: optionalText(300),
  about: optionalText(4000),
  // ClientIntake-specific additions (not already on Client).
  targetAudience: optionalText(4000),
  offerDetails: optionalText(4000),
  brandGuidelinesUrl: optionalText(500),
  additionalNotes: optionalText(4000),
});

export type ClientIntakeInput = z.infer<typeof clientIntakeSchema>;
