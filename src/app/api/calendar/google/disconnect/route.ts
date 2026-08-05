import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await prisma.teamMemberCalendarConnection.findUnique({ where: { teamMemberId: session.user.id } });
  if (!existing) {
    return NextResponse.json({ ok: true });
  }

  await prisma.$transaction([
    prisma.teamMemberBusyBlock.deleteMany({ where: { teamMemberId: session.user.id } }),
    prisma.teamMemberCalendarConnection.delete({ where: { teamMemberId: session.user.id } }),
  ]);

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? "Someone",
    entityType: "TeamMember",
    entityId: session.user.id,
    entityLabel: session.user.name ?? "Team member",
    action: "calendar_disconnected",
    description: `${session.user.name ?? "Someone"} disconnected their Google Calendar`,
  });

  return NextResponse.json({ ok: true });
}
