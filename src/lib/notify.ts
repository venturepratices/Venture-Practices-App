import { absoluteUrlFor } from "@/lib/notification-links";
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
   * App-relative path to the entity this is about (e.g.
   * "/clients/<id>/tasks?taskId=<id>") — stored on the Notification row for
   * the in-app row to navigate with, and appended to the Slack message as a
   * clickable "Open in app" link. Omit when the caller has no clean deep
   * link to offer (rare — most call sites have enough context).
   */
  linkPath?: string | null;
  /**
   * Set false to skip the Slack post for this particular notification while
   * still creating the in-app row — used for high-volume asset events
   * (uploads/comments/decisions) where every recipient's own Slack post
   * would spam the channel. Defaults to true (matches existing task behavior).
   */
  slack?: boolean;
};

/**
 * Best-effort post to the shared Slack channel; silently skipped if
 * unconfigured, never throws. `linkPath`, when given, renders as a clickable
 * "Open in app" line using Slack's `<url|label>` mrkdwn syntax.
 */
export async function postToSlack(message: string, linkPath?: string | null) {
  if (!process.env.SLACK_WEBHOOK_URL) {
    console.warn("SLACK_WEBHOOK_URL not set — Slack post skipped:", message);
    return;
  }
  const text = linkPath ? `🔔 ${message}\n<${absoluteUrlFor(linkPath)}|Open in app>` : `🔔 ${message}`;
  try {
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
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
        linkPath: params.linkPath ?? null,
      },
    });

    if (params.slack ?? true) {
      await postToSlack(params.message, params.linkPath);
    }

    return notification;
  } catch (error) {
    console.warn("notify() failed, continuing without it:", error);
    return null;
  }
}
