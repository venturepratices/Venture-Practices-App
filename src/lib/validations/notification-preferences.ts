import { z } from "zod";

import { NOTIFICATION_CATEGORIES } from "@/lib/notification-preferences";

export const notificationPreferencesSchema = z.object({
  slackEnabled: z.boolean(),
  mutedCategories: z.array(z.enum(NOTIFICATION_CATEGORIES as [string, ...string[]])),
  ambientDigest: z.boolean(),
});

/**
 * A personal Slack member ID or a channel/group ID — same loose shape as
 * `team-member.ts`'s admin-side `slackUserId` field (no prefix/format
 * validation, since Slack's own API is what actually resolves it).
 */
export const slackDestinationSchema = z.object({
  slackUserId: z.string().trim().max(20).optional().nullable(),
});
