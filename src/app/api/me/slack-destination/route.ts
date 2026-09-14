import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { slackDestinationSchema } from "@/lib/validations/notification-preferences";

/**
 * Self-service — where a person's own Slack notifications go. Writes the
 * same `TeamMember.slackUserId` column the admin Team dialog writes: a
 * personal Slack member ID (starts with U) DMs them, a channel ID (starts
 * with C or G) posts there instead — Slack's own chat.postMessage treats
 * whichever is stored transparently, so no other code needs to branch on it
 * (see src/lib/slack.ts's resolveSlackUserId/postSlackCard). No admin gate:
 * everyone can always control where THEIR OWN notifications land, same as
 * the rest of this settings page.
 */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = slackDestinationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Slack ID" }, { status: 400 });
  }

  await prisma.teamMember.update({
    where: { id: session.user.id },
    data: { slackUserId: parsed.data.slackUserId || null },
  });

  return NextResponse.json({ ok: true });
}
