import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { restoreArchivedTask } from "@/lib/archive";
import { canSeeArchivedTask } from "@/lib/archived-task-snapshot";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: Promise<{ archivedTaskId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The archive is a sensitive surface (deleted-data history) — same gate as viewing it.
  let restorer;
  try {
    restorer = await requireCapability("canRestoreArchive");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { archivedTaskId } = await params;

  const archived = await prisma.archivedTask.findUnique({ where: { id: archivedTaskId } });
  // Another person's private task 404s, as it does while live.
  if (!archived || !canSeeArchivedTask(archived, restorer.userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (archived.clientId) {
    try {
      await requireClientAccess(archived.clientId);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  const task = await restoreArchivedTask(archivedTaskId, restorer.userId);

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Task",
    entityId: task.id,
    entityLabel: task.title,
    clientId: task.clientId,
    action: "restored",
    description: `${session.user.name ?? "Someone"} restored task "${task.title}" from the archive`,
  });

  return NextResponse.json(task, { status: 201 });
}
