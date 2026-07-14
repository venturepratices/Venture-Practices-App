import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { restoreArchivedTask } from "@/lib/archive";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: Promise<{ archivedTaskId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { archivedTaskId } = await params;

  const archived = await prisma.archivedTask.findUnique({ where: { id: archivedTaskId } });
  if (!archived) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const task = await restoreArchivedTask(archivedTaskId);

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Task",
    entityId: task.id,
    entityLabel: task.title,
    action: "restored",
    description: `${session.user.name ?? "Someone"} restored task "${task.title}" from the archive`,
  });

  return NextResponse.json(task, { status: 201 });
}
