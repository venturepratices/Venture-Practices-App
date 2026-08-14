import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postSlackDM, resolveSlackUserId } from "@/lib/slack";

/**
 * Sends a real, harmless message through the exact same pipe every real
 * notification uses (postSlackDM), so someone can confirm their own Slack DM
 * is actually wired up without waiting for a real event to trigger one.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const member = await prisma.teamMember.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, slackUserId: true },
  });
  if (!member) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const slackUserId = await resolveSlackUserId(member);
  if (!slackUserId) {
    return NextResponse.json(
      { error: "Couldn't resolve your Slack account. Ask an admin to set your Slack member ID on your Team profile." },
      { status: 422 }
    );
  }

  await postSlackDM(slackUserId, "*🔔 Test notification*\nIf you're reading this in Slack, your DM delivery is working.");

  return NextResponse.json({ ok: true });
}
