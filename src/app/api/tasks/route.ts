import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { notify } from "@/lib/notify";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { mentionOrName } from "@/lib/slack";
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

  // A task tied to a client requires access to that client, in addition to
  // the create-tasks capability everyone (client-scoped or internal) needs.
  // A task attached directly to a campaign stage or a workflow instance is a
  // structural change to that pipeline (same gate as creating it), not a
  // plain task add.
  try {
    if (parsed.data.campaignId) {
      await requireCapability("canManageDirectMail");
    } else if (parsed.data.workflowInstanceId) {
      await requireCapability("canManageWorkflows");
    } else {
      await requireCapability("canCreateTasks");
    }
    if (parsed.data.clientId) await requireClientAccess(parsed.data.clientId);
  } catch (error) {
    return toErrorResponse(error);
  }

  if (parsed.data.workflowInstanceId) {
    const instance = await prisma.workflowInstance.findUnique({
      where: { id: parsed.data.workflowInstanceId },
      select: { id: true, clientId: true },
    });
    if (!instance) {
      return NextResponse.json({ error: "Project not found" }, { status: 400 });
    }
    if (instance.clientId) {
      try {
        await requireClientAccess(instance.clientId);
      } catch (error) {
        return toErrorResponse(error);
      }
    }
  }

  const assigneeIds = [...new Set(parsed.data.assigneeIds ?? [])];

  // Ad-hoc tasks added to a live workflow stage get appended after whatever
  // ordered tasks already exist there, so the intra-stage "you're up next"
  // ping (see notifyNextTaskInStage) has something to chain onto.
  let workflowTaskOrder: number | null = null;
  if (parsed.data.workflowInstanceId && parsed.data.workflowStageNumber != null) {
    const maxOrder = await prisma.task.aggregate({
      where: { workflowInstanceId: parsed.data.workflowInstanceId, workflowStageNumber: parsed.data.workflowStageNumber },
      _max: { workflowTaskOrder: true },
    });
    workflowTaskOrder = (maxOrder._max.workflowTaskOrder ?? 0) + 1;
  }

  // Auto-set from the task's real link, but an explicit kind from the caller
  // always wins (lets someone relabel it, e.g. via the task detail panel).
  const defaultKind = parsed.data.workflowInstanceId ? "PROJECT" : parsed.data.campaignId ? "DIRECT_MAIL" : "TASK";

  const task = await prisma.task.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      clientId: parsed.data.clientId ?? null,
      campaignId: parsed.data.campaignId ?? null,
      campaignStage: parsed.data.campaignStage ?? null,
      workflowInstanceId: parsed.data.workflowInstanceId ?? null,
      workflowStageNumber: parsed.data.workflowStageNumber ?? null,
      workflowTaskOrder,
      kind: parsed.data.kind ?? defaultKind,
      isPrivate: parsed.data.isPrivate ?? false,
      createdById: session.user.id,
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.occurrence ? { occurrence: parsed.data.occurrence } : {}),
      ...(parsed.data.deadline !== undefined ? { deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : null } : {}),
      assignees: { create: assigneeIds.map((teamMemberId) => ({ teamMemberId })) },
    },
    include: { assignees: { include: { teamMember: { select: { id: true, name: true, email: true, slackUserId: true } } } } },
  });

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Task",
    entityId: task.id,
    entityLabel: task.title,
    clientId: task.clientId,
    action: "created",
    description: `${session.user.name ?? "Someone"} created task "${task.title}"`,
  });

  const linkPath = task.workflowInstanceId
    ? task.clientId
      ? `/clients/${task.clientId}/workflows/${task.workflowInstanceId}?taskId=${task.id}`
      : `/workflows/${task.workflowInstanceId}?taskId=${task.id}`
    : task.clientId
      ? `/clients/${task.clientId}/tasks?taskId=${task.id}`
      : `/tasks?taskId=${task.id}`;

  for (const a of task.assignees) {
    if (a.teamMemberId === session.user.id) continue;
    const mention = await mentionOrName(a.teamMember, a.teamMember.name);
    await notify({
      recipientId: a.teamMemberId,
      type: "ASSIGNED",
      entityType: "Task",
      entityId: task.id,
      entityLabel: task.title,
      message: `${a.teamMember.name} — you were assigned to "${task.title}" by ${session.user.name ?? "someone"}`,
      slackMessage: `${mention} — you were assigned to "${task.title}" by ${session.user.name ?? "someone"}`,
      linkPath,
    });
  }

  return NextResponse.json(task, { status: 201 });
}
