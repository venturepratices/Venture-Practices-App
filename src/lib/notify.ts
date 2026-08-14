import { absoluteUrlFor } from "@/lib/notification-links";
import { getNotificationTier, TIER_EMOJI } from "@/lib/notification-tier";
import { isCategoryMuted, parseNotificationPreferences } from "@/lib/notification-preferences";
import { prisma } from "@/lib/prisma";
import { buildSlackCard, CHANNEL_COLOR, deriveCardFromLegacy, TIER_COLOR, type SlackCardField } from "@/lib/slack-card";
import { postSlackCard, resolveSlackUserId } from "@/lib/slack";
import { buildKicker, entityTypeLabel } from "@/lib/notification-type-labels";
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
   * Short bullet points carrying the who/where/when. Only used as a fallback
   * for the Slack card's detail area when `fields` isn't supplied — prefer
   * `fields`, which renders as a scannable two-column grid instead.
   */
  lines?: string[];
  /**
   * Slack-only presentation. `title` stays the in-app row's text; these
   * split it into the card's bold first line (the kind of event, e.g.
   * "Task assigned to you") and its plain second line (the thing itself,
   * e.g. the task title). Omit both and the card falls back to using `title`
   * as the headline, which still reads fine — just less scannable.
   */
  headline?: string;
  subject?: string | null;
  /** Labelled detail rows, rendered as Slack's two-column field grid. Max 10. */
  fields?: SlackCardField[];
  /** Small muted line under the details — a comment excerpt, a caveat. */
  context?: string | null;
  /** Button text. Defaults to "Open in app". Only renders when `linkPath` is set too. */
  buttonLabel?: string;
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

function buildNotifyCard(params: NotifyParams) {
  const tier = getNotificationTier(params.type);
  const derived = deriveCardFromLegacy(params.title, params.lines);
  const headline = params.headline ?? derived.headline;

  // Never let the card come up emptier than the app's own record of the
  // event: if nothing supplied a subject line, fall back to entityLabel
  // (the task/asset/client name this notification is actually about) rather
  // than leaving the card as a bare headline with no specifics.
  const explicitSubject = params.subject !== undefined ? params.subject : derived.subject;
  const subject = explicitSubject ?? (params.entityLabel !== headline ? params.entityLabel : null);

  return buildSlackCard({
    kicker: buildKicker(params.entityType, params.type),
    headline,
    subject,
    subjectLabel: entityTypeLabel(params.entityType),
    fields: params.fields ?? derived.fields,
    bullets: params.fields ? [] : derived.bullets,
    color: TIER_COLOR[tier],
    emoji: tier === "CRITICAL" ? TIER_EMOJI[tier] : null,
    buttonLabel: params.linkPath ? (params.buttonLabel ?? "Open in app") : null,
    buttonUrl: params.linkPath ? absoluteUrlFor(params.linkPath) : null,
    context: params.context ?? null,
  });
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
        await postSlackCard(slackUserId, buildNotifyCard(params));
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
  buttonLabel?: string;
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
    let clientName: string | null = null;
    if (params.clientId) {
      const client = await prisma.client.findUnique({ where: { id: params.clientId }, select: { slackChannelId: true, name: true } });
      channelId = client?.slackChannelId ?? null;
      clientName = client?.name ?? null;
    }
    if (!channelId) channelId = process.env.SLACK_INTERNAL_CHANNEL_ID ?? null;
    if (!channelId) return;

    const derived = deriveCardFromLegacy(params.title, params.lines);
    const card = buildSlackCard({
      kicker: clientName ? `${clientName} · Team update` : "Team update",
      headline: derived.headline,
      subject: derived.subject,
      fields: derived.fields,
      bullets: derived.bullets,
      color: CHANNEL_COLOR,
      emoji: "📣",
      buttonLabel: params.linkPath ? (params.buttonLabel ?? "Open in app") : null,
      buttonUrl: params.linkPath ? absoluteUrlFor(params.linkPath) : null,
    });
    await postSlackCard(channelId, card);
  } catch (error) {
    console.warn("notifyChannel() failed, continuing without it:", error);
  }
}
