import { NextResponse } from "next/server";

import { absoluteUrlFor } from "@/lib/notification-links";
import { ambientNotificationTypes } from "@/lib/notification-tier";
import { prisma } from "@/lib/prisma";
import { postSlackDM, resolveSlackUserId } from "@/lib/slack";

// Prisma + the Neon WebSocket driver require the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Batches every not-yet-digested Ambient-tier Notification row (asset
 * uploads/comments, due-soon reminders — see src/lib/notification-tier.ts)
 * into one Slack DM per recipient, instead of the instant-DM treatment
 * Critical/Important tiers get. Runs a few times a day (see vercel.json —
 * multiple single-daily-time cron entries hitting this same route, since
 * Vercel's plan only allows one invocation per cron entry per day) so
 * Ambient volume never becomes a stream of individual interruptions.
 *
 * Skips a recipient's batch (leaving their rows undigested for the next
 * run) if their Slack mapping can't be resolved right now — never marks a
 * row digested without at least attempting the post, so nothing silently
 * disappears into a batch nobody ever saw.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pending = await prisma.notification.findMany({
    where: { type: { in: ambientNotificationTypes() }, digestedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, recipientId: true, message: true, linkPath: true },
  });

  if (pending.length === 0) {
    return NextResponse.json({ ok: true, recipients: 0, notifications: 0 });
  }

  const byRecipient = new Map<string, typeof pending>();
  for (const n of pending) {
    const list = byRecipient.get(n.recipientId) ?? [];
    list.push(n);
    byRecipient.set(n.recipientId, list);
  }

  const recipients = await prisma.teamMember.findMany({
    where: { id: { in: [...byRecipient.keys()] } },
    select: { id: true, email: true, slackUserId: true },
  });
  const recipientById = new Map(recipients.map((r) => [r.id, r]));

  let sentCount = 0;
  let digestedCount = 0;
  const now = new Date();

  for (const [recipientId, items] of byRecipient) {
    const recipient = recipientById.get(recipientId);
    const slackUserId = recipient ? await resolveSlackUserId(recipient) : null;
    if (!slackUserId) continue; // leave undigested — picked up by a later run once mapped

    const lines = items.map((n) => (n.linkPath ? `<${absoluteUrlFor(n.linkPath)}|${n.message}>` : n.message));
    const text = `*🔵 Digest — ${items.length} update${items.length === 1 ? "" : "s"}*\n${lines.map((l) => `• ${l}`).join("\n")}`;
    await postSlackDM(slackUserId, text);
    sentCount++;

    await prisma.notification.updateMany({
      where: { id: { in: items.map((n) => n.id) } },
      data: { digestedAt: now },
    });
    digestedCount += items.length;
  }

  return NextResponse.json({
    ok: true,
    recipients: sentCount,
    recipientsSkipped: byRecipient.size - sentCount,
    notifications: digestedCount,
  });
}
