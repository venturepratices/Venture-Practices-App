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
};

/**
 * Fans out one notification: writes a Notification row (in-app), and
 * best-effort posts to a shared Slack channel if configured. Mirrors the
 * "guarded by env var, warn-and-skip if absent" pattern already used for Blob
 * credentials in src/lib/archive.ts and src/lib/backup.ts. The whole function
 * swallows its own errors — a notification is a side effect of a task/comment
 * mutation that has already succeeded by the time this is called, so a failure
 * here (Slack down, a bad write) must never bubble up and turn an otherwise-
 * successful task update/comment into a 500.
 */
export async function notify(params: NotifyParams) {
  try {
    const notification = await prisma.notification.create({ data: params });

    if (process.env.SLACK_WEBHOOK_URL) {
      try {
        await fetch(process.env.SLACK_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: `🔔 ${params.message}` }),
        });
      } catch (error) {
        console.warn("Slack notification failed:", error);
      }
    } else {
      console.warn("SLACK_WEBHOOK_URL not set — Slack notification skipped for", notification.id);
    }

    return notification;
  } catch (error) {
    console.warn("notify() failed, continuing without it:", error);
    return null;
  }
}
