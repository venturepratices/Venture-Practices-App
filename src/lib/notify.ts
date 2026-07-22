import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@/generated/prisma/client";

type NotifyParams = {
  recipientId: string;
  type: NotificationType;
  entityType: string;
  entityId: string;
  entityLabel: string;
  /** Full sentence, already naming who it's for — used as-is for the Slack message. */
  message: string;
  /**
   * Set false to skip the Slack post for this particular notification while
   * still creating the in-app row — used for high-volume asset events
   * (uploads/comments/decisions) where every recipient's own Slack post
   * would spam the channel. Defaults to true (matches existing task behavior).
   */
  slack?: boolean;
};

/** Best-effort post to the shared Slack channel; silently skipped if unconfigured, never throws. */
export async function postToSlack(message: string) {
  if (!process.env.SLACK_WEBHOOK_URL) {
    console.warn("SLACK_WEBHOOK_URL not set — Slack post skipped:", message);
    return;
  }
  try {
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `🔔 ${message}` }),
    });
  } catch (error) {
    console.warn("Slack post failed:", error);
  }
}

/**
 * Fans out one notification: writes a Notification row (in-app), and
 * best-effort posts to a shared Slack channel if configured (unless
 * `slack: false`). Mirrors the "guarded by env var, warn-and-skip if absent"
 * pattern already used for Blob credentials in src/lib/archive.ts and
 * src/lib/backup.ts. The whole function swallows its own errors — a
 * notification is a side effect of a mutation that has already succeeded by
 * the time this is called, so a failure here (Slack down, a bad write) must
 * never bubble up and turn an otherwise-successful update into a 500.
 */
export async function notify(params: NotifyParams) {
  try {
    const notification = await prisma.notification.create({
      data: {
        recipientId: params.recipientId,
        type: params.type,
        entityType: params.entityType,
        entityId: params.entityId,
        entityLabel: params.entityLabel,
        message: params.message,
      },
    });

    if (params.slack ?? true) {
      await postToSlack(params.message);
    }

    return notification;
  } catch (error) {
    console.warn("notify() failed, continuing without it:", error);
    return null;
  }
}
