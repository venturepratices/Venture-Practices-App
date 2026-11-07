import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSlackAccountForEmail } from "@/lib/slack";
import { slackDestinationSchema } from "@/lib/validations/notification-preferences";

const NOT_A_MEMBER_ID =
  "That isn't a Slack member ID. Member IDs start with U, like U0123ABCD45. To send your notifications to a channel, ask an admin.";
const NOT_CONFIRMED =
  "We couldn't confirm that Slack member ID is yours. Only the Slack account with your email address can go here. Ask an admin to set it for you.";

/**
 * Self-service: lets a person set their own Slack member ID, or clear it to
 * go back to matching by email. Writes the same `TeamMember.slackUserId`
 * column the admin Team dialog writes.
 *
 * Old audit #13: this used to take any 20 characters, so a person could send
 * their notifications (which carry client details) to a coworker's Slack or
 * into a channel, and the channel sync would then invite that Slack account
 * into every client channel the person can see. Now it takes only a Slack
 * member ID, and only the one Slack says belongs to the person's own email
 * (checked on their team record, never on anything sent in the request).
 * When Slack can't confirm it, the answer is no: an admin can still set any
 * member or channel ID from the Team page.
 */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A client-portal login has a session but no team record.
  const member = await prisma.teamMember.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true },
  });
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = slackDestinationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: NOT_A_MEMBER_ID }, { status: 400 });
  }

  const slackUserId = parsed.data.slackUserId || null;
  if (slackUserId && !(await isSlackAccountForEmail(slackUserId, member.email))) {
    return NextResponse.json({ error: NOT_CONFIRMED }, { status: 403 });
  }

  await prisma.teamMember.update({
    where: { id: member.id },
    data: { slackUserId },
  });

  return NextResponse.json({ ok: true });
}
