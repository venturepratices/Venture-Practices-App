import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { notify } from "@/lib/notify";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { convertPlanningItemSchema } from "@/lib/validations/planning";

// "Move to task" — the one planning-status transition that does real work
// beyond a status flip: it creates a genuine, visible Task (so the normal
// ASSIGNED notification fires for free) and only then marks the idea
// CONVERTED, keeping it around (not deleted) for history via convertedTaskId.
export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { itemId } = await params;
  const item = await prisma.planningItem.findUnique({ where: { id: itemId } });
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await requireClientAccess(item.clientId);
    await requireCapability("canManagePlanning");
  } catch (error) {
    return toErrorResponse(error);
  }
  if (item.status === "CONVERTED") {
    return NextResponse.json({ error: "This idea has already been converted to a task." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = convertPlanningItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const assigneeIds = [...new Set(parsed.data.assigneeIds)];

  const task = await prisma.task.create({
    data: {
      title: item.title,
      description: item.description,
      clientId: item.clientId,
      kind: "TASK",
      statusId: "NEXT_UP",
      createdById: session.user.id,
      assignees: { create: assigneeIds.map((teamMemberId) => ({ teamMemberId })) },
    },
    include: { assignees: { include: { teamMember: { select: { id: true, name: true, email: true, slackUserId: true } } } } },
  });

  await prisma.planningItem.update({
    where: { id: itemId },
    data: { status: "CONVERTED", convertedTaskId: task.id },
  });

  const linkPath = task.clientId ? `/clients/${task.clientId}/tasks?taskId=${task.id}` : `/tasks?taskId=${task.id}`;
  const client = await prisma.client.findUnique({ where: { id: item.clientId }, select: { name: true } });
  for (const a of task.assignees) {
    if (a.teamMemberId === session.user.id) continue;
    await notify({
      recipientId: a.teamMemberId,
      type: "ASSIGNED",
      entityType: "Task",
      entityId: task.id,
      entityLabel: task.title,
      title: `You're assigned: "${task.title}"`,
      lines: [`Assigned by ${session.user.name ?? "someone"}`, `From a Planning idea — ${client?.name ?? "client"}`],
      linkPath,
    });
  }

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: item.clientId,
    entityLabel: client?.name ?? item.clientId,
    clientId: item.clientId,
    action: "planning_item_converted",
    description: `${session.user.name ?? "Someone"} converted planning idea "${item.title}" into a task`,
  });

  return NextResponse.json({ task, planningItemId: item.id });
}
