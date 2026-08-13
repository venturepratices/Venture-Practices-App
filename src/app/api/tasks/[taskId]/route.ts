import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { archiveTask } from "@/lib/archive";
import { logActivity } from "@/lib/activity-log";
import { maybeAdvanceCampaignStage } from "@/lib/campaign-advance";
import { notify, notifyChannel } from "@/lib/notify";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { maybeCreateNextOccurrence } from "@/lib/recurring-tasks";
import { mentionOrName } from "@/lib/slack";
import { deadlineLine, formatDate } from "@/lib/utils";
import { maybeAdvanceWorkflowStage, notifyNextTaskInStage } from "@/lib/workflow-advance";
import { getTaskStatusOptions, isCompleteStatusId, isValidStatusId } from "@/lib/task-status";
import { statusLabelMap } from "@/lib/task-status-utils";
import { updateTaskSchema } from "@/lib/validations/task";

const OCCURRENCE_LABELS: Record<string, string> = {
  RECURRING_WEEKLY: "Recurring Weekly",
  RECURRING_MONTHLY: "Recurring Monthly",
  RECURRING_QUARTERLY: "Recurring Quarterly",
  PROJECT: "Project",
  NON_RECURRING: "Non Recurring",
};

const TASK_INCLUDE = {
  assignees: { include: { teamMember: { select: { id: true, name: true, email: true, slackUserId: true } } } },
  client: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  statusOption: { select: { id: true, label: true, tone: true, isComplete: true } },
  comments: {
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" as const },
  },
  links: { orderBy: { createdAt: "asc" as const } },
  subtasks: { orderBy: { sequenceNumber: "asc" as const } },
  campaign: { select: { id: true, sequenceNumber: true, currentStage: true } },
} as const;

export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: TASK_INCLUDE });
  // A private task 404s (not 403 — leak nothing) for anyone but its creator,
  // including a stale notification link or a guessed URL.
  if (!task || (task.isPrivate && task.createdById !== session.user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Same client-access check PATCH/DELETE already have — without it, a
  // Member scoped to specific clients could read any task's full detail by
  // id, including for a client they have no access to.
  if (task.clientId) {
    try {
      await requireClientAccess(task.clientId);
    } catch (error) {
      return toErrorResponse(error);
    }
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
    include: { assignees: { select: { teamMemberId: true } }, client: { select: { name: true } } },
  });
  if (!before || (before.isPrivate && before.createdById !== session.user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await requireCapability("canEditTasks");
    if (before.clientId) await requireClientAccess(before.clientId);
  } catch (error) {
    return toErrorResponse(error);
  }

  if (parsed.data.status && !(await isValidStatusId(parsed.data.status))) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const { deadline, assigneeIds, isPrivate, status, ...rest } = parsed.data;
  // Only the task's creator may toggle Private — a non-creator's isPrivate
  // value in the request body is silently ignored rather than rejected, so
  // an otherwise-valid edit from a non-creator doesn't fail outright.
  const canTogglePrivacy = before.createdById === null || before.createdById === session.user.id;
  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      ...rest,
      ...(status ? { statusId: status } : {}),
      ...(isPrivate !== undefined && canTogglePrivacy ? { isPrivate } : {}),
      ...(deadline !== undefined ? { deadline: deadline ? new Date(deadline) : null } : {}),
      ...(assigneeIds !== undefined
        ? {
            assignees: {
              deleteMany: { teamMemberId: { notIn: assigneeIds } },
              createMany: { data: assigneeIds.map((teamMemberId) => ({ teamMemberId })), skipDuplicates: true },
            },
          }
        : {}),
    },
    include: TASK_INCLUDE,
  });

  const linkPath = task.workflowInstanceId
    ? task.clientId
      ? `/clients/${task.clientId}/workflows/${task.workflowInstanceId}?taskId=${task.id}`
      : `/workflows/${task.workflowInstanceId}?taskId=${task.id}`
    : task.clientId
      ? `/clients/${task.clientId}/tasks?taskId=${task.id}`
      : `/tasks?taskId=${task.id}`;

  if (before) {
    const changes: string[] = [];
    if (parsed.data.title !== undefined && parsed.data.title !== before.title) {
      changes.push(`renamed to "${parsed.data.title}"`);
    }
    if (status !== undefined && status !== before.statusId) {
      const statusLabels = statusLabelMap(await getTaskStatusOptions());
      const newStatusLabel = statusLabels[status] ?? status;
      changes.push(`status changed to ${newStatusLabel}`);
      for (const a of task.assignees) {
        if (a.teamMemberId === session.user.id) continue;
        await notify({
          recipientId: a.teamMemberId,
          type: "STATUS_CHANGED",
          entityType: "Task",
          entityId: task.id,
          entityLabel: task.title,
          title: `Status changed: "${task.title}"`,
          lines: [`Now: ${newStatusLabel}`, `Changed by ${session.user.name ?? "someone"}`, ...deadlineLine(task.deadline)],
          linkPath,
        });
      }
      if (!task.isPrivate) {
        await notifyChannel({
          clientId: task.clientId,
          title: `Status changed: "${task.title}"`,
          lines: [`Now: ${newStatusLabel}`, `Changed by ${session.user.name ?? "someone"}`, ...deadlineLine(task.deadline)],
          linkPath,
        });
      }
    }
    if (assigneeIds !== undefined) {
      const beforeIds = new Set(before.assignees.map((a) => a.teamMemberId));
      const added = task.assignees.filter((a) => !beforeIds.has(a.teamMemberId));
      const afterIds = new Set(task.assignees.map((a) => a.teamMemberId));
      const changed = added.length > 0 || before.assignees.some((a) => !afterIds.has(a.teamMemberId));
      if (changed) {
        const names = task.assignees.map((a) => a.teamMember.name);
        changes.push(`assignees changed to ${names.length > 0 ? names.join(", ") : "Unassigned"}`);
      }
      for (const a of added) {
        if (a.teamMemberId === session.user.id) continue;
        await notify({
          recipientId: a.teamMemberId,
          type: "ASSIGNED",
          entityType: "Task",
          entityId: task.id,
          entityLabel: task.title,
          title: `You're assigned: "${task.title}"`,
          lines: [
            `Assigned by ${session.user.name ?? "someone"}`,
            task.client ? `Client: ${task.client.name}` : "Internal task",
            ...deadlineLine(task.deadline),
          ],
          linkPath,
        });
      }
      if (!task.isPrivate && added.length > 0) {
        const addedMentions = await Promise.all(
          added.map((a) => mentionOrName(a.teamMember, a.teamMember.name))
        );
        await notifyChannel({
          clientId: task.clientId,
          title: `Assigned: "${task.title}"`,
          lines: [`Now assigned to: ${addedMentions.join(", ")}`, ...deadlineLine(task.deadline)],
          linkPath,
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
        const deadlineLabel = deadline ? formatDate(deadline) : "none";
        changes.push(`deadline changed to ${deadlineLabel}`);
        for (const a of task.assignees) {
          if (a.teamMemberId === session.user.id) continue;
          await notify({
            recipientId: a.teamMemberId,
            type: "DEADLINE_CHANGED",
            entityType: "Task",
            entityId: task.id,
            entityLabel: task.title,
            title: `Deadline changed: "${task.title}"`,
            lines: [`New deadline: ${deadlineLabel}`, `Changed by ${session.user.name ?? "someone"}`],
            linkPath,
          });
        }
        if (!task.isPrivate) {
          await notifyChannel({
            clientId: task.clientId,
            title: `Deadline changed: "${task.title}"`,
            lines: [`New deadline: ${deadlineLabel}`, `Changed by ${session.user.name ?? "someone"}`],
            linkPath,
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
        clientId: task.clientId,
        action: "updated",
        description: `${session.user.name ?? "Someone"} updated "${task.title}": ${changes.join(", ")}`,
      });
    }

    if (!(await isCompleteStatusId(before.statusId)) && (await isCompleteStatusId(task.statusId))) {
      const next = await maybeCreateNextOccurrence(task);
      if (next) {
        await logActivity({
          actorId: null,
          actorName: null,
          entityType: "Task",
          entityId: next.id,
          entityLabel: next.title,
          clientId: next.clientId,
          action: "created",
          description: `Automatically created the next occurrence of "${next.title}"`,
        });
        const nextLinkPath = next.clientId ? `/clients/${next.clientId}/tasks?taskId=${next.id}` : `/tasks?taskId=${next.id}`;
        for (const a of next.assignees) {
          await notify({
            recipientId: a.teamMemberId,
            type: "ASSIGNED",
            entityType: "Task",
            entityId: next.id,
            entityLabel: next.title,
            title: `New recurring task: "${next.title}"`,
            lines: [`Carried over from the previous occurrence`, ...deadlineLine(next.deadline)],
            linkPath: nextLinkPath,
          });
        }
      }

      if (task.campaignId) {
        await maybeAdvanceCampaignStage(task.campaignId, session.user.id);
      }

      if (task.workflowInstanceId && task.workflowStageNumber != null) {
        await notifyNextTaskInStage(
          task.workflowInstanceId,
          task.workflowStageNumber,
          { id: task.id, title: task.title, workflowTaskOrder: task.workflowTaskOrder },
          session.user.id,
          session.user.name ?? "someone"
        );
        await maybeAdvanceWorkflowStage(task.workflowInstanceId, session.user.id);
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
  if (!task || (task.isPrivate && task.createdById !== session.user.id)) {
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
      clientId: task.clientId,
      action: "deleted",
      description: `${session.user.name ?? "Someone"} archived task "${task.title}"`,
    });
  }

  return NextResponse.json({ ok: true });
}
