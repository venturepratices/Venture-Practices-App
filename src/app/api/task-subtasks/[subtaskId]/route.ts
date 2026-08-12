import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const updateSubtaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  completed: z.boolean().optional(),
});

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
    include: { task: { select: { clientId: true, isPrivate: true, createdById: true } } },
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
    include: { task: { select: { clientId: true, isPrivate: true, createdById: true } } },
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

  return NextResponse.json({ ok: true });
}
