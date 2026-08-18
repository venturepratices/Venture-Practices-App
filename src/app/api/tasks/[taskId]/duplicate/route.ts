import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { notify, notifyChannel } from "@/lib/notify";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { mentionOrName } from "@/lib/slack";
import { stripHtml } from "@/lib/text-format";
import { deadlineLine } from "@/lib/utils";
import { TASK_INCLUDE } from "@/app/api/tasks/[taskId]/route";

/**
 * Clones a task into a brand-new one — same client/assignees/description/
 * links/subtasks/pipeline attachment, but a fresh status ("NEXT_UP", same
 * literal convention as maybeCreateNextOccurrence) and no deadline, since a
 * duplicate's whole point is starting the next round of work, not repeating
 * a stale due date. Comments are deliberately NOT copied — a duplicate is a
 * new task, not a fork of the old one's conversation.
 *
 * Built for the recurring-with-a-changing-title case (e.g. "Socials Email -
 * August" becoming "...- September") that the built-in recurring-task
 * auto-regeneration can't handle, since it always keeps the same title.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  const original = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignees: { select: { teamMemberId: true } },
      links: { select: { label: true, url: true } },
      subtasks: { select: { title: true, sequenceNumber: true }, orderBy: { sequenceNumber: "asc" } },
    },
  });
  // Same "404, not 403" rule as every other task route — a private task
  // leaks nothing to anyone but its creator.
  if (!original || (original.isPrivate && original.createdById !== session.user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Same gating shape as POST /api/tasks: a duplicate that lands in a
  // campaign stage or workflow stage is a structural change to that
  // pipeline, not a plain task add.
  try {
    if (original.campaignId) {
      await requireCapability("canManageDirectMail");
    } else if (original.workflowInstanceId) {
      await requireCapability("canManageWorkflows");
    } else {
      await requireCapability("canCreateTasks");
    }
    if (original.clientId) await requireClientAccess(original.clientId);
  } catch (error) {
    return toErrorResponse(error);
  }

  // Ad-hoc tasks appended to a live workflow stage get the next order slot,
  // same computation as the create route.
  let workflowTaskOrder: number | null = null;
  if (original.workflowInstanceId && original.workflowStageNumber != null) {
    const maxOrder = await prisma.task.aggregate({
      where: { workflowInstanceId: original.workflowInstanceId, workflowStageNumber: original.workflowStageNumber },
      _max: { workflowTaskOrder: true },
    });
    workflowTaskOrder = (maxOrder._max.workflowTaskOrder ?? 0) + 1;
  }

  const title = `${original.title} (Copy)`;

  const task = await prisma.task.create({
    data: {
      title,
      description: original.description,
      clientId: original.clientId,
      campaignId: original.campaignId,
      campaignStage: original.campaignStage,
      workflowInstanceId: original.workflowInstanceId,
      workflowStageNumber: original.workflowStageNumber,
      workflowTaskOrder,
      occurrence: original.occurrence,
      kind: original.kind,
      isPrivate: original.isPrivate,
      statusId: "NEXT_UP",
      deadline: null,
      createdById: session.user.id,
      assignees: { create: original.assignees.map((a) => ({ teamMemberId: a.teamMemberId })) },
      links: { create: original.links.map((l) => ({ label: l.label, url: l.url })) },
      subtasks: {
        create: original.subtasks.map((s) => ({ title: s.title, sequenceNumber: s.sequenceNumber, completed: false })),
      },
    },
    include: TASK_INCLUDE,
  });

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Task",
    entityId: task.id,
    entityLabel: task.title,
    clientId: task.clientId,
    action: "created",
    description: `${session.user.name ?? "Someone"} duplicated task "${original.title}" as "${task.title}"`,
  });

  const linkPath = task.workflowInstanceId
    ? task.clientId
      ? `/clients/${task.clientId}/workflows/${task.workflowInstanceId}?taskId=${task.id}`
      : `/workflows/${task.workflowInstanceId}?taskId=${task.id}`
    : task.clientId
      ? `/clients/${task.clientId}/tasks?taskId=${task.id}`
      : `/tasks?taskId=${task.id}`;

  const assignedFields = [
    ...(task.description ? [{ label: "Description", value: stripHtml(task.description) }] : []),
    { label: "Client", value: task.client ? task.client.name : "Internal (no client)" },
    { label: "Status", value: task.statusOption.label },
  ];

  for (const a of task.assignees) {
    if (a.teamMemberId === session.user.id) continue;
    await notify({
      recipientId: a.teamMemberId,
      type: "ASSIGNED",
      entityType: "Task",
      entityId: task.id,
      entityLabel: task.title,
      title: `You're assigned: "${task.title}"`,
      fields: assignedFields,
      context: `Duplicated by ${session.user.name ?? "someone"}`,
      linkPath,
    });
  }

  if (!task.isPrivate && task.assignees.length > 0) {
    const assignedMentions = await Promise.all(
      task.assignees.map((a) => mentionOrName({ id: a.teamMemberId, email: a.teamMember.email, slackUserId: a.teamMember.slackUserId }, a.teamMember.name))
    );
    await notifyChannel({
      clientId: task.clientId,
      title: `New task: "${task.title}"`,
      lines: [`Assigned to: ${assignedMentions.join(", ")}`, ...deadlineLine(task.deadline)],
      linkPath,
    });
  }

  return NextResponse.json(task, { status: 201 });
}
