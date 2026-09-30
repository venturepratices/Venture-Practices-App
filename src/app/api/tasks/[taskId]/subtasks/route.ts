import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { TaskActivityDetails } from "@/lib/task-activity";

const createSubtaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
});

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = createSubtaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { title: true, clientId: true, isPrivate: true, createdById: true },
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

  const last = await prisma.taskSubtask.findFirst({ where: { taskId }, orderBy: { sequenceNumber: "desc" }, select: { sequenceNumber: true } });
  const subtask = await prisma.taskSubtask.create({
    data: { taskId, title: parsed.data.title, sequenceNumber: (last?.sequenceNumber ?? 0) + 1 },
  });

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Task",
    entityId: taskId,
    entityLabel: task.title,
    clientId: task.clientId,
    action: "subtask_added",
    description: `${session.user.name ?? "Someone"} added the subtask "${subtask.title}" to "${task.title}"`,
    details: { subtask: { title: subtask.title } } satisfies TaskActivityDetails,
  });

  return NextResponse.json(subtask, { status: 201 });
}
