import { absoluteUrlFor } from "@/lib/notification-links";
import { getNotificationTier, TIER_EMOJI } from "@/lib/notification-tier";
import { isCategoryMuted, parseNotificationPreferences } from "@/lib/notification-preferences";
import { prisma } from "@/lib/prisma";
import { postSlackChannel, postSlackDM, resolveSlackUserId } from "@/lib/slack";
import type { NotificationType } from "@/generated/prisma/client";

type NotifyParams = {
  recipientId: string;
  type: NotificationType;
  entityType: string;
  entityId: string;
  entityLabel: string;
  /**
   * The fact, stated plainly — never the recipient's own name (this is
   * always a 1:1 DM to them; saying their name back is redundant). Becomes
   * both the in-app row's text and the bold Slack headline. E.g. `You're
   * assigned: "Fix homepage CTA button"`, not `DJ — you were assigned...`.
   */
  title: string;
  /**
   * Short bullet points carrying the who/where/when — rendered as a Slack
   * bullet list under the headline. Omit for a headline-only message when
   * there's genuinely nothing else worth saying.
   */
  lines?: string[];
  /**
   * App-relative path to the entity this is about (e.g.
   * "/clients/<id>/tasks?taskId=<id>") — stored on the Notification row for
   * the in-app row to navigate with, and appended to the Slack message as a
   * clickable "Open in app" link. Omit when the caller has no clean deep
   * link to offer (rare — most call sites have enough context).
   */
  linkPath?: string | null;
  /**
   * Set false to skip Slack entirely for this particular notification while
   * still creating the in-app row. Every notification type reaches Slack by
   * default — this is only for genuine one-off exceptions, not a per-type
   * "quiet" setting (that's what tiers are for). Has no effect on
   * Ambient-tier types either way — those always queue for the digest cron
   * instead of an instant DM, regardless of this flag.
   */
  slack?: boolean;
};

function buildSlackText(type: NotificationType, title: string, lines: string[] | undefined, linkPath?: string | null) {
  const emoji = TIER_EMOJI[getNotificationTier(type)];
  const bulletBlock = lines && lines.length > 0 ? `\n${lines.map((l) => `• ${l}`).join("\n")}` : "";
  const body = `*${emoji} ${title}*${bulletBlock}`;
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
    const tier = getNotificationTier(params.type);

    const recipient = await prisma.teamMember.findUnique({
      where: { id: params.recipientId },
      select: { id: true, email: true, slackUserId: true, notificationPreferences: true },
    });
    if (!recipient) return null;

    const prefs = parseNotificationPreferences(recipient.notificationPreferences);
    // A muted category is suppressed entirely — no in-app row either. This is
    // "stop telling me about this," not just "stop pinging me on Slack about
    // it" (that's what the slackEnabled switch below is for).
    if (isCategoryMuted(prefs, params.type)) return null;

    const notification = await prisma.notification.create({
      data: {
        recipientId: params.recipientId,
        type: params.type,
        entityType: params.entityType,
        entityId: params.entityId,
        entityLabel: params.entityLabel,
        message: params.title,
        linkPath: params.linkPath ?? null,
      },
    });

    // Ambient-tier rows never get an instant DM — they queue for the next
    // notification-digest cron run instead (src/app/api/cron/notification-
    // digest/route.ts), which is what actually posts to Slack for them.
    if ((params.slack ?? true) && tier !== "AMBIENT" && prefs.slackEnabled) {
      const slackUserId = await resolveSlackUserId(recipient);
      if (slackUserId) {
        const text = buildSlackText(params.type, params.title, params.lines, params.linkPath);
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
  title: string;
  lines?: string[];
  linkPath?: string | null;
};

/**
 * Posts ONE team-facing summary of a headline event to the relevant Slack
 * channel — a client's own private channel if `clientId` resolves to one, or
 * the general internal channel otherwise. Deliberately separate from
 * notify(), which fans out per-recipient (looping this into that per-
 * recipient loop would post the same event to the channel once per person).
 * Always uses the 📣 "team broadcast" marker rather than a tier emoji — this
 * is a different kind of message (many people, one summary) than a personal
 * DM, regardless of how urgent the underlying event was. Callers construct
 * their own team-facing text (not the same "you"-addressed text used for the
 * DM) and call this exactly once per event. Never throws.
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

    const bulletBlock = params.lines && params.lines.length > 0 ? `\n${params.lines.map((l) => `• ${l}`).join("\n")}` : "";
    const body = `*📣 ${params.title}*${bulletBlock}`;
    const text = params.linkPath ? `${body}\n<${absoluteUrlFor(params.linkPath)}|Open in app>` : body;
    await postSlackChannel(channelId, text);
  } catch (error) {
    console.warn("notifyChannel() failed, continuing without it:", error);
  }
}
