import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { archiveTask } from "@/lib/archive";
import { logActivity } from "@/lib/activity-log";
import { notify } from "@/lib/notify";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { maybeCreateNextOccurrence } from "@/lib/recurring-tasks";
import { TASK_STATUS_LABELS } from "@/components/tasks/status-pill";
import { updateTaskSchema } from "@/lib/validations/task";

const OCCURRENCE_LABELS: Record<string, string> = {
  RECURRING_WEEKLY: "Recurring Weekly",
  RECURRING_MONTHLY: "Recurring Monthly",
  RECURRING_QUARTERLY: "Recurring Quarterly",
  PROJECT: "Project",
  NON_RECURRING: "Non Recurring",
};

const TASK_INCLUDE = {
  assignee: { select: { id: true, name: true } },
  client: { select: { id: true, name: true } },
  comments: {
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" as const },
  },
  links: { orderBy: { createdAt: "asc" as const } },
} as const;

export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: TASK_INCLUDE });
  if (!task) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(task);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const before = await prisma.task.findUnique({
    where: { id: taskId },
    include: { assignee: { select: { name: true } }, client: { select: { name: true } } },
  });
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await requireCapability("canEditTasks");
    if (before.clientId) await requireClientAccess(before.clientId);
  } catch (error) {
    return toErrorResponse(error);
  }

  const { deadline, ...rest } = parsed.data;
  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      ...rest,
      ...(deadline !== undefined ? { deadline: deadline ? new Date(deadline) : null } : {}),
    },
    include: TASK_INCLUDE,
  });

  if (before) {
    const changes: string[] = [];
    if (parsed.data.title !== undefined && parsed.data.title !== before.title) {
      changes.push(`renamed to "${parsed.data.title}"`);
    }
    if (parsed.data.status !== undefined && parsed.data.status !== before.status) {
      changes.push(`status changed to ${TASK_STATUS_LABELS[parsed.data.status]}`);
      if (task.assigneeId && task.assigneeId !== session.user.id) {
        await notify({
          recipientId: task.assigneeId,
          type: "STATUS_CHANGED",
          entityType: "Task",
          entityId: task.id,
          entityLabel: task.title,
          message: `${task.assignee?.name ?? "Someone"} — the status of "${task.title}" changed to ${TASK_STATUS_LABELS[parsed.data.status]} (by ${session.user.name ?? "someone"})`,
        });
      }
    }
    if (parsed.data.assigneeId !== undefined && parsed.data.assigneeId !== before.assigneeId) {
      changes.push(`assignee changed to ${task.assignee?.name ?? "Unassigned"}`);
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
    }
    if (parsed.data.clientId !== undefined && parsed.data.clientId !== before.clientId) {
      changes.push(`client changed to ${task.client?.name ?? "Internal / Agency"}`);
    }
    if (parsed.data.occurrence !== undefined && parsed.data.occurrence !== before.occurrence) {
      changes.push(`occurrence changed to ${OCCURRENCE_LABELS[parsed.data.occurrence]}`);
    }
    if (deadline !== undefined) {
      const newTime = deadline ? new Date(deadline).getTime() : null;
      const oldTime = before.deadline ? before.deadline.getTime() : null;
      if (newTime !== oldTime) {
        const deadlineLabel = deadline ? new Date(deadline).toLocaleDateString() : "none";
        changes.push(`deadline changed to ${deadlineLabel}`);
        if (task.assigneeId && task.assigneeId !== session.user.id) {
          await notify({
            recipientId: task.assigneeId,
            type: "DEADLINE_CHANGED",
            entityType: "Task",
            entityId: task.id,
            entityLabel: task.title,
            message: `${task.assignee?.name ?? "Someone"} — the deadline for "${task.title}" changed to ${deadlineLabel} (by ${session.user.name ?? "someone"})`,
          });
        }
      }
    }

    if (changes.length > 0) {
      await logActivity({
        actorId: session.user.id,
        actorName: session.user.name ?? null,
        entityType: "Task",
        entityId: task.id,
        entityLabel: task.title,
        action: "updated",
        description: `${session.user.name ?? "Someone"} updated "${task.title}": ${changes.join(", ")}`,
      });
    }

    if (before.status !== "COMPLETE" && task.status === "COMPLETE") {
      const next = await maybeCreateNextOccurrence(task);
      if (next) {
        await logActivity({
          actorId: null,
          actorName: null,
          entityType: "Task",
          entityId: next.id,
          entityLabel: next.title,
          action: "created",
          description: `Automatically created the next occurrence of "${next.title}"`,
        });
        if (next.assigneeId) {
          await notify({
            recipientId: next.assigneeId,
            type: "ASSIGNED",
            entityType: "Task",
            entityId: next.id,
            entityLabel: next.title,
            message: `${next.assignee?.name ?? "Someone"} — you have a new recurring task: "${next.title}"`,
          });
        }
      }
    }
  }

  return NextResponse.json(task);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await requireCapability("canDeleteTasks");
    if (task.clientId) await requireClientAccess(task.clientId);
  } catch (error) {
    return toErrorResponse(error);
  }
  await archiveTask(taskId, session.user.id);

  {
    await logActivity({
      actorId: session.user.id,
      actorName: session.user.name ?? null,
      entityType: "Task",
      entityId: taskId,
      entityLabel: task.title,
      action: "deleted",
      description: `${session.user.name ?? "Someone"} archived task "${task.title}"`,
    });
  }

  return NextResponse.json({ ok: true });
}
