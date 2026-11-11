import { NextResponse } from "next/server";

import { canSeeArchivedTask } from "@/lib/archived-task-snapshot";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ archivedTaskId: string }> }) {
  // Staff with archive access only. A client-portal login or a removed staff
  // member has no team member row, so gets a 401 before anything is looked up.
  let viewer;
  try {
    viewer = await requireCapability("canViewArchive");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { archivedTaskId } = await params;
  const archivedTask = await prisma.archivedTask.findUnique({
    where: { id: archivedTaskId },
    include: { deletedBy: { select: { name: true } } },
  });

  // Another person's private task 404s, as it does while live.
  if (!archivedTask || !canSeeArchivedTask(archivedTask, viewer.userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // An internal (no-client) task is open to everyone with archive access, as
  // it is to all staff while live.
  if (archivedTask.clientId) {
    try {
      await requireClientAccess(archivedTask.clientId);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  return NextResponse.json(archivedTask);
}
