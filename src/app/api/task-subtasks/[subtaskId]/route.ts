import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { TaskActivityDetails } from "@/lib/task-activity";

const updateSubtaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  completed: z.boolean().optional(),
});

const SUBTASK_TASK_SELECT = { select: { id: true, title: true, clientId: true, isPrivate: true, createdById: true } } as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ subtaskId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { subtaskId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateSubtaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const subtask = await prisma.taskSubtask.findUnique({
    where: { id: subtaskId },
    include: { task: SUBTASK_TASK_SELECT },
  });
  if (!subtask || (subtask.task.isPrivate && subtask.task.createdById !== session.user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await requireCapability("canEditTasks");
    if (subtask.task.clientId) await requireClientAccess(subtask.task.clientId);
  } catch (error) {
    return toErrorResponse(error);
  }

  const updated = await prisma.taskSubtask.update({
    where: { id: subtaskId },
    data: parsed.data,
  });

  if (parsed.data.completed !== undefined && parsed.data.completed !== subtask.completed) {
    await logActivity({
      actorId: session.user.id,
      actorName: session.user.name ?? null,
      entityType: "Task",
      entityId: subtask.task.id,
      entityLabel: subtask.task.title,
      clientId: subtask.task.clientId,
      action: parsed.data.completed ? "subtask_completed" : "subtask_reopened",
      description: `${session.user.name ?? "Someone"} ${parsed.data.completed ? "checked off" : "unchecked"} the subtask "${updated.title}" on "${subtask.task.title}"`,
      details: { subtask: { title: updated.title } } satisfies TaskActivityDetails,
    });
  }

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ subtaskId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { subtaskId } = await params;
  const subtask = await prisma.taskSubtask.findUnique({
    where: { id: subtaskId },
    include: { task: SUBTASK_TASK_SELECT },
  });
  if (!subtask || (subtask.task.isPrivate && subtask.task.createdById !== session.user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await requireCapability("canEditTasks");
    if (subtask.task.clientId) await requireClientAccess(subtask.task.clientId);
  } catch (error) {
    return toErrorResponse(error);
  }

  await prisma.taskSubtask.delete({ where: { id: subtaskId } });

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Task",
    entityId: subtask.task.id,
    entityLabel: subtask.task.title,
    clientId: subtask.task.clientId,
    action: "subtask_removed",
    description: `${session.user.name ?? "Someone"} removed the subtask "${subtask.title}" from "${subtask.task.title}"`,
    details: { subtask: { title: subtask.title } } satisfies TaskActivityDetails,
  });

  return NextResponse.json({ ok: true });
}
