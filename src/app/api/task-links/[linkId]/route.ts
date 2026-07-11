import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: Request, { params }: { params: Promise<{ linkId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { linkId } = await params;
  const link = await prisma.taskLink.findUnique({ where: { id: linkId }, include: { task: { select: { title: true } } } });
  await prisma.taskLink.delete({ where: { id: linkId } });

  if (link) {
    await logActivity({
      actorId: session.user.id,
      actorName: session.user.name ?? null,
      entityType: "Task",
      entityId: link.taskId,
      entityLabel: link.task.title,
      action: "link_removed",
      description: `${session.user.name ?? "Someone"} removed the link "${link.label}" from "${link.task.title}"`,
    });
  }

  return NextResponse.json({ ok: true });
}
