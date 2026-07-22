import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ clientId: string; meetingId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clientId, meetingId } = await params;
  try {
    await requireClientAccess(clientId);
    await requireCapability("canDeleteMeetingNotes");
  } catch (error) {
    return toErrorResponse(error);
  }

  const target = await prisma.meetingNote.findUnique({ where: { id: meetingId }, select: { clientId: true } });
  if (!target || target.clientId !== clientId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.meetingNote.delete({ where: { id: meetingId } });

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: clientId,
    entityLabel: client?.name ?? clientId,
    action: "meeting_note_deleted",
    description: `${session.user.name ?? "Someone"} deleted a meeting note from "${client?.name ?? "a client"}"`,
  });

  return NextResponse.json({ ok: true });
}
