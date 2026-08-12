import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@/generated/prisma/client";

/**
 * True if a notification of this type already went out for this entity
 * within `windowHours` (or ever, when omitted) — the dedupe guard every
 * once-daily reminder cron needs so a retry or a second run within the same
 * day doesn't re-ping. Extracted from the near-identical checks that used to
 * live separately in asset-due-soon and task-due-soon.
 */
export async function hasRecentNotification(
  type: NotificationType,
  entityId: string,
  windowHours?: number
): Promise<boolean> {
  const existing = await prisma.notification.findFirst({
    where: {
      type,
      entityId,
      ...(windowHours ? { createdAt: { gte: new Date(Date.now() - windowHours * 60 * 60 * 1000) } } : {}),
    },
    select: { id: true },
  });
  return existing !== null;
}
