import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  accessibleClientFilter,
  requireCapability,
  requireClientAccess,
  toErrorResponse,
} from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * Adds one subtask per active client to the task, so a personal checklist
 * task (e.g. "Website check — August") doesn't require typing every client
 * name by hand. Skips clients already listed as subtasks (case-insensitive
 * match by title) so it's safe to click again after new clients are added,
 * with no duplicates.
 *
 * Scoped to the caller's accessibleClientFilter — a member with per-client
 * access only populates the clients they can see, matching every other list
 * read in the app. OFFBOARDED clients are excluded (they're archived from
 * daily work; adding them to a fresh checklist would just be noise).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { clientId: true, isPrivate: true, createdById: true },
  });
  if (!task || (task.isPrivate && task.createdById !== session.user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await requireCapability("canEditTasks");
    if (task.clientId) await requireClientAccess(task.clientId);
  } catch (error) {
    return toErrorResponse(error);
  }

  const clientFilter = await accessibleClientFilter("id");
  const clients = await prisma.client.findMany({
    where: { AND: [clientFilter, { status: { not: "OFFBOARDED" } }] },
    select: { name: true },
    orderBy: { name: "asc" },
  });

  const existingSubtasks = await prisma.taskSubtask.findMany({
    where: { taskId },
    select: { title: true, sequenceNumber: true },
  });
  const existingTitles = new Set(existingSubtasks.map((s) => s.title.trim().toLowerCase()));
  const startingSequence = existingSubtasks.reduce((max, s) => Math.max(max, s.sequenceNumber), 0);

  const toCreate = clients
    .filter((c) => !existingTitles.has(c.name.trim().toLowerCase()))
    .map((c, index) => ({
      taskId,
      title: c.name,
      sequenceNumber: startingSequence + index + 1,
    }));

  if (toCreate.length > 0) {
    await prisma.taskSubtask.createMany({ data: toCreate });
  }

  return NextResponse.json(
    { addedCount: toCreate.length, skippedCount: clients.length - toCreate.length },
    { status: 201 }
  );
}
