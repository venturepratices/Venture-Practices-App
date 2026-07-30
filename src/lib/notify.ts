import { absoluteUrlFor } from "@/lib/notification-links";
import { prisma } from "@/lib/prisma";
import { postSlackChannel, postSlackDM, resolveSlackUserId } from "@/lib/slack";
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
   * Override just the Slack-bound version of `message` — typically the same
   * sentence with a plain name swapped for a real `<@SLACK_ID>` mention via
   * `mentionOrName()`, so Slack actually pings the person instead of showing
   * inert text — while the in-app `message` keeps the plain name. Ignored
   * when `slackTitle`/`slackLines` are given (those already build their own
   * text, independent of `message`).
   */
  slackMessage?: string;
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
   * still creating the in-app row — used for high-volume events (asset
   * uploads/comments/decisions) where a Slack DM per event would still be
   * noisy for that person even though it's no longer a shared channel.
   * Defaults to true.
   */
  slack?: boolean;
  /**
   * Optional structured Slack formatting: a short bold headline plus bulleted
   * detail lines, in place of the plain `message` sentence (which still
   * powers the in-app row either way). Omit to keep the plain one-line Slack
   * post — most call sites haven't been converted to this format yet.
   */
  slackTitle?: string;
  slackLines?: string[];
};

function buildSlackText(message: string, linkPath?: string | null, structured?: { title: string; lines: string[] }) {
  const body = structured
    ? `*🔔 ${structured.title}*\n${structured.lines.map((l) => `• ${l}`).join("\n")}`
    : `🔔 ${message}`;
  return linkPath ? `${body}\n<${absoluteUrlFor(linkPath)}|Open in app>` : body;
}

/**
 * Fans out one notification: writes a Notification row (in-app), and —
 * unless `slack: false` — best-effort DMs the recipient on Slack personally
 * (see src/lib/slack.ts), so each person's own Slack DMs are their
 * notification feed instead of one shared, ever-growing channel. Mirrors the
 * "guarded by config, warn-and-skip if unresolvable" pattern already used for
 * Blob credentials in src/lib/archive.ts and src/lib/backup.ts. The whole
 * function swallows its own errors — a notification is a side effect of a
 * mutation that has already succeeded by the time this is called, so a
 * failure here (Slack down, no Slack mapping, a bad write) must never bubble
 * up and turn an otherwise-successful update into a 500.
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
      const recipient = await prisma.teamMember.findUnique({
        where: { id: params.recipientId },
        select: { id: true, email: true, slackUserId: true },
      });
      const slackUserId = recipient ? await resolveSlackUserId(recipient) : null;
      if (slackUserId) {
        const text = buildSlackText(
          params.slackMessage ?? params.message,
          params.linkPath,
          params.slackTitle ? { title: params.slackTitle, lines: params.slackLines ?? [] } : undefined
        );
        await postSlackDM(slackUserId, text);
      }
    }

    return notification;
  } catch (error) {
    console.warn("notify() failed, continuing without it:", error);
    return null;
  }
}

type NotifyChannelParams = {
  /** The client this event is about, if any — routes to that client's Slack channel. Null/omitted routes to the general SLACK_INTERNAL_CHANNEL_ID channel. */
  clientId?: string | null;
  message: string;
  linkPath?: string | null;
  slackTitle?: string;
  slackLines?: string[];
};

/**
 * Posts ONE team-facing summary of a headline event to the relevant Slack
 * channel — a client's own private channel if `clientId` resolves to one, or
 * the general internal channel otherwise. Deliberately separate from
 * notify(), which fans out per-recipient (looping this into that per-
 * recipient loop would post the same event to the channel once per person).
 * Callers construct their own team-facing message text (not the same
 * personalized "this is your task" text used for the DM) and call this
 * exactly once per event. Never throws.
 */
export async function notifyChannel(params: NotifyChannelParams) {
  try {
    let channelId: string | null = null;
    if (params.clientId) {
      const client = await prisma.client.findUnique({ where: { id: params.clientId }, select: { slackChannelId: true } });
      channelId = client?.slackChannelId ?? null;
    }
    if (!channelId) channelId = process.env.SLACK_INTERNAL_CHANNEL_ID ?? null;
    if (!channelId) return;

    const text = buildSlackText(
      params.message,
      params.linkPath,
      params.slackTitle ? { title: params.slackTitle, lines: params.slackLines ?? [] } : undefined
    );
    await postSlackChannel(channelId, text);
  } catch (error) {
    console.warn("notifyChannel() failed, continuing without it:", error);
  }
}
