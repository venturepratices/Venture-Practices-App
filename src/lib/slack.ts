import { prisma } from "@/lib/prisma";

/**
 * Personal-DM Slack delivery via the Slack Web API (a real Slack App's Bot
 * Token), replacing the old single-channel Incoming Webhook model. Every
 * notification already has a specific recipient — this resolves that
 * recipient's own Slack account and DMs them directly, so each person's
 * Slack DMs become their own notification feed instead of one shared,
 * ever-growing channel.
 */

type ResolvableTeamMember = { id: string; email: string; slackUserId: string | null };

/**
 * Returns the Slack user id to DM for this team member, or null if none can
 * be determined (caller should skip Slack silently in that case — never
 * blocks or errors the underlying notification).
 *
 * `slackUserId` on the TeamMember row is single-source-of-truth for two
 * distinct paths that both just set the same field: an admin manually
 * pasting a specific Slack Member ID (always wins, checked first), or a
 * prior auto-lookup by email that got cached here so it only runs once.
 */
export async function resolveSlackUserId(teamMember: ResolvableTeamMember): Promise<string | null> {
  if (teamMember.slackUserId) return teamMember.slackUserId;

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;

  try {
    const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(teamMember.email)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as { ok: boolean; user?: { id: string } };
    if (!data.ok || !data.user?.id) return null;

    await prisma.teamMember.update({ where: { id: teamMember.id }, data: { slackUserId: data.user.id } });
    return data.user.id;
  } catch (error) {
    console.warn("Slack email lookup failed:", error);
    return null;
  }
}

/**
 * DMs a resolved Slack user id via chat.postMessage — passing a user id as
 * `channel` opens/uses that user's DM with the bot, no separate
 * conversations.open call needed. Never throws; a failed Slack post must
 * never break the mutation that triggered it.
 */
export async function postSlackDM(slackUserId: string, text: string) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.warn("SLACK_BOT_TOKEN not set — Slack DM skipped:", text);
    return;
  }
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: slackUserId, text }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    if (!data.ok) console.warn("Slack DM failed:", data.error);
  } catch (error) {
    console.warn("Slack DM failed:", error);
  }
}
