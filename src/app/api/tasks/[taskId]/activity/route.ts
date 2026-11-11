import { NextResponse } from "next/server";

import { requireClientAccess, requireUser, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { buildTaskActivityEvents } from "@/lib/task-activity";

// Generous ceiling rather than pagination — even a very busy task stays well
// under this, and the Activity tab already reveals older rows progressively.
const MAX_ROWS = 500;

export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  // Staff only, like GET /api/tasks/[taskId]: a client-portal login gets a
  // 401 before any task is looked up.
  let viewer;
  try {
    viewer = await requireUser();
  } catch (error) {
    return toErrorResponse(error);
  }

  const { taskId } = await params;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { isPrivate: true, createdById: true, clientId: true },
  });
  // Same visibility rules as GET /api/tasks/[taskId]: a private task 404s for
  // anyone but its creator, and a client-scoped member needs that client.
  if (!task || (task.isPrivate && task.createdById !== viewer.userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (task.clientId) {
    try {
      await requireClientAccess(task.clientId);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  const [logs, comments] = await Promise.all([
    prisma.activityLog.findMany({
      where: { entityType: "Task", entityId: taskId },
      select: { id: true, action: true, description: true, actorName: true, details: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
    }),
    prisma.comment.findMany({
      where: { taskId },
      select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
    }),
  ]);

  return NextResponse.json({ events: buildTaskActivityEvents(logs, comments) });
}
