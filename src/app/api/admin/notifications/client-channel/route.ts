import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { ensureClientChannel } from "@/lib/slack";

const bodySchema = z.object({ clientId: z.string().min(1) });

/**
 * Creates the per-client Slack channel on demand. `ensureClientChannel` only
 * fires from `createClientAction`, so every client that predates the Slack
 * wiring is stuck without one and nothing in the app ever backfills them —
 * this is the admin-facing escape hatch for exactly that case (and for a
 * creation that failed at the time because the token/scopes weren't set yet).
 *
 * Idempotent by way of `ensureClientChannel` itself, which returns the cached
 * id untouched when one already exists.
 */
export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (error) {
    return toErrorResponse(error);
  }

  if (!process.env.SLACK_BOT_TOKEN) {
    return NextResponse.json({ error: "SLACK_BOT_TOKEN isn't set." }, { status: 422 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const client = await prisma.client.findUnique({
    where: { id: parsed.data.clientId },
    select: { id: true, name: true, slackChannelId: true },
  });
  if (!client) {
    return NextResponse.json({ error: "That client no longer exists." }, { status: 404 });
  }

  const alreadyHadChannel = !!client.slackChannelId;
  const channelId = await ensureClientChannel(client);

  if (!channelId) {
    return NextResponse.json(
      { error: "Slack refused to create the channel. It may already exist under that name — set the channel ID manually on the client's Info page." },
      { status: 422 }
    );
  }

  if (!alreadyHadChannel) {
    const session = await auth();
    await logActivity({
      actorId: session?.user?.id ?? null,
      actorName: session?.user?.name ?? null,
      entityType: "Client",
      entityId: client.id,
      entityLabel: client.name,
      clientId: client.id,
      action: "slack_channel_created",
      description: `${session?.user?.name ?? "Someone"} created the Slack channel for "${client.name}"`,
    });
  }

  return NextResponse.json({ ok: true, channelId });
}
