import { z } from "zod";

import { NOTIFICATION_CATEGORIES } from "@/lib/notification-preferences";
import { SLACK_MEMBER_ID_PATTERN } from "@/lib/slack-ids";

export const notificationPreferencesSchema = z.object({
  slackEnabled: z.boolean(),
  mutedCategories: z.array(z.enum(NOTIFICATION_CATEGORIES as [string, ...string[]])),
  ambientDigest: z.boolean(),
});

/**
 * The person's own Slack member ID, or empty to go back to matching by email.
 * Channel IDs are refused here (old audit #13): sending someone's
 * notifications to a channel or another account is admin-only, through
 * `team-member.ts`'s admin-side field. The route also checks with Slack that
 * the ID is the account with the person's own email.
 */
export const slackDestinationSchema = z.object({
  slackUserId: z
    .string()
    .trim()
    .refine((value) => value === "" || SLACK_MEMBER_ID_PATTERN.test(value))
    .optional()
    .nullable(),
});
