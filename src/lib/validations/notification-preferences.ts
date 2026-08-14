import { z } from "zod";

import { NOTIFICATION_CATEGORIES } from "@/lib/notification-preferences";

export const notificationPreferencesSchema = z.object({
  slackEnabled: z.boolean(),
  mutedCategories: z.array(z.enum(NOTIFICATION_CATEGORIES as [string, ...string[]])),
  ambientDigest: z.boolean(),
});
