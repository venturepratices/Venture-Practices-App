import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { createTaskSchema } from "@/lib/validations/task";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const task = await prisma.task.create({
    data: {
      title: parsed.data.title,
      clientId: parsed.data.clientId ?? null,
      assigneeId: parsed.data.assigneeId ?? null,
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.occurrence ? { occurrence: parsed.data.occurrence } : {}),
      ...(parsed.data.deadline !== undefined ? { deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : null } : {}),
    },
    include: { assignee: { select: { id: true, name: true } } },
  });

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Task",
    entityId: task.id,
    entityLabel: task.title,
    action: "created",
    description: `${session.user.name ?? "Someone"} created task "${task.title}"`,
  });

  if (task.assigneeId && task.assigneeId !== session.user.id) {
    await notify({
      recipientId: task.assigneeId,
      type: "ASSIGNED",
      entityType: "Task",
      entityId: task.id,
      entityLabel: task.title,
      message: `${task.assignee?.name ?? "Someone"} — you were assigned to "${task.title}" by ${session.user.name ?? "someone"}`,
    });
  }

  return NextResponse.json(task, { status: 201 });
}
