import * as Sentry from "@sentry/nextjs";

import { prisma } from "@/lib/prisma";

/**
 * Slack delivery via the Slack Web API (a real Slack App's Bot Token):
 * personal DMs (every notification's specific recipient) plus per-client
 * private channels for headline events the whole team working on that
 * client should see (see notifyChannel() in src/lib/notify.ts). Channel
 * membership mirrors this app's own per-client access rules from
 * src/lib/permissions.ts — someone who can't see a client in the app
 * shouldn't see its Slack channel either.
 */

async function slackApi<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.warn(`SLACK_BOT_TOKEN not set — Slack API call skipped: ${method}`);
    return null;
  }
  try {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as T & { ok: boolean; error?: string };
    if (!data.ok) {
      console.warn(`Slack API ${method} failed:`, data.error);
      Sentry.captureMessage(`Slack API ${method} failed: ${data.error}`, "warning");
    }
    return data;
  } catch (error) {
    console.warn(`Slack API ${method} failed:`, error);
    Sentry.captureException(error, { extra: { slackMethod: method } });
    return null;
  }
}

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
    Sentry.captureException(error, { extra: { teamMemberId: teamMember.id } });
    return null;
  }
}

/**
 * Returns a real Slack @mention (`<@USERID>`) for this team member when
 * their Slack account is resolved, so Slack actually pings/highlights them
 * — including inside a channel post many people see — instead of rendering
 * inert plain text. Falls back to `displayName` when unresolved, so an
 * unmapped person's name still reads fine, just without the ping.
 */
export async function mentionOrName(teamMember: ResolvableTeamMember, displayName: string): Promise<string> {
  const slackUserId = await resolveSlackUserId(teamMember);
  return slackUserId ? `<@${slackUserId}>` : displayName;
}

/**
 * DMs a resolved Slack user id via chat.postMessage — passing a user id as
 * `channel` opens/uses that user's DM with the bot, no separate
 * conversations.open call needed.
 */
export async function postSlackDM(slackUserId: string, text: string) {
  await slackApi("chat.postMessage", { channel: slackUserId, text });
}

/** Posts once to a resolved channel id — the client's own channel, or the general fallback. */
export async function postSlackChannel(channelId: string, text: string) {
  await slackApi("chat.postMessage", { channel: channelId, text });
}

function slugifyChannelName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 70);
  return `client-${slug || "unnamed"}`;
}

async function everyoneWithBlanketClientAccess(): Promise<string[]> {
  const members = await prisma.teamMember.findMany({
    where: { OR: [{ isAdmin: true }, { allClientsAccess: true }] },
    select: { slackUserId: true, email: true, id: true },
  });
  const ids: string[] = [];
  for (const m of members) {
    const slackId = await resolveSlackUserId(m);
    if (slackId) ids.push(slackId);
  }
  return ids;
}

/**
 * Returns this client's Slack channel id, creating a private channel and
 * caching it on first use if one doesn't exist yet. Every current admin +
 * `allClientsAccess` member is invited at creation time (a brand-new client
 * has no specific `ClientAccess` grants yet, so there's nothing else to
 * invite). Never throws; returns null if unconfigured or the API call fails.
 */
export async function ensureClientChannel(client: { id: string; name: string; slackChannelId: string | null }): Promise<string | null> {
  if (client.slackChannelId) return client.slackChannelId;
  if (!process.env.SLACK_BOT_TOKEN) return null;

  const created = await slackApi<{ channel?: { id: string } }>("conversations.create", {
    name: slugifyChannelName(client.name),
    is_private: true,
  });
  const channelId = created?.channel?.id;
  if (!channelId) return null;

  await prisma.client.update({ where: { id: client.id }, data: { slackChannelId: channelId } });

  const inviteIds = await everyoneWithBlanketClientAccess();
  if (inviteIds.length > 0) {
    await slackApi("conversations.invite", { channel: channelId, users: inviteIds.join(",") });
  }

  return channelId;
}

/**
 * Reconciles a team member's membership across every client channel to
 * match their CURRENT effective access — admins and `allClientsAccess`
 * members belong in every client-with-a-channel, everyone else only in the
 * channels for clients they have a specific `ClientAccess` grant for.
 * Declarative (recompute desired state, invite/kick to match) rather than
 * diffing against a "before" snapshot, so every access-changing action can
 * call this the same way with no bespoke delta logic. Invite/kick calls on
 * someone already in/out of a channel are harmless no-ops (Slack's
 * already_in_channel / not_in_channel errors are logged, not thrown).
 */
export async function syncTeamMemberClientChannels(teamMemberId: string) {
  if (!process.env.SLACK_BOT_TOKEN) return;

  const member = await prisma.teamMember.findUnique({
    where: { id: teamMemberId },
    select: {
      id: true,
      email: true,
      slackUserId: true,
      isAdmin: true,
      allClientsAccess: true,
      clientAccess: { select: { clientId: true } },
    },
  });
  if (!member) return;

  const slackUserId = await resolveSlackUserId(member);
  if (!slackUserId) return;

  const clientsWithChannels = await prisma.client.findMany({
    where: { slackChannelId: { not: null } },
    select: { id: true, slackChannelId: true },
  });

  const hasBlanketAccess = member.isAdmin || member.allClientsAccess;
  const grantedClientIds = new Set(member.clientAccess.map((c) => c.clientId));

  for (const client of clientsWithChannels) {
    if (!client.slackChannelId) continue;
    const shouldBeIn = hasBlanketAccess || grantedClientIds.has(client.id);
    if (shouldBeIn) {
      await slackApi("conversations.invite", { channel: client.slackChannelId, users: slackUserId });
    } else {
      await slackApi("conversations.kick", { channel: client.slackChannelId, user: slackUserId });
    }
  }
}

/**
 * Archives a client's Slack channel — called when the client itself is
 * permanently deleted, so its channel doesn't linger in the workspace forever
 * (Slack archive is reversible from the Slack side if that's ever needed).
 * Never throws; silently no-ops if unconfigured, already archived, or the
 * channel id is stale.
 */
export async function archiveClientChannel(channelId: string) {
  if (!process.env.SLACK_BOT_TOKEN) return;
  await slackApi("conversations.archive", { channel: channelId });
}

/** Removes a team member from every client channel — used right before deleting them. */
export async function removeTeamMemberFromAllClientChannels(teamMemberId: string) {
  if (!process.env.SLACK_BOT_TOKEN) return;

  const member = await prisma.teamMember.findUnique({
    where: { id: teamMemberId },
    select: { id: true, email: true, slackUserId: true },
  });
  if (!member) return;

  const slackUserId = await resolveSlackUserId(member);
  if (!slackUserId) return;

  const clientsWithChannels = await prisma.client.findMany({
    where: { slackChannelId: { not: null } },
    select: { slackChannelId: true },
  });
  for (const client of clientsWithChannels) {
    if (client.slackChannelId) await slackApi("conversations.kick", { channel: client.slackChannelId, user: slackUserId });
  }
}
