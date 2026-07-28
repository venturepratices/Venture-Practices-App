import { NextResponse } from "next/server";

import { archiveTask } from "@/lib/archive";
import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const INSTANCE_INCLUDE = {
  client: { select: { id: true, name: true } },
  workflowTemplate: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  tasks: {
    include: { assignees: { include: { teamMember: { select: { id: true, name: true } } } } },
    orderBy: [{ workflowStageNumber: "asc" as const }, { createdAt: "asc" as const }],
  },
};

export async function GET(_request: Request, { params }: { params: Promise<{ instanceId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireCapability("canViewWorkflows");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { instanceId } = await params;
  const instance = await prisma.workflowInstance.findUnique({ where: { id: instanceId }, include: INSTANCE_INCLUDE });
  if (!instance) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (instance.clientId) {
    try {
      await requireClientAccess(instance.clientId);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  return NextResponse.json(instance);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ instanceId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { instanceId } = await params;
  const instance = await prisma.workflowInstance.findUnique({
    where: { id: instanceId },
    include: { client: { select: { name: true } }, tasks: { select: { id: true, title: true } } },
  });
  if (!instance) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await requireCapability("canManageWorkflows");
    if (instance.clientId) await requireClientAccess(instance.clientId);
  } catch (error) {
    return toErrorResponse(error);
  }

  // Unlike Cancel (which detaches tasks and leaves them live), Delete follows
  // this app's universal "delete = archive" convention — every task the
  // workflow spawned is archived via the same archiveTask() the single-task
  // delete route uses, recoverable from /archive. Sequential, not
  // Promise.all: archiveTask does a write transaction per task, and the
  // Prisma client here is a single shared connection.
  for (const task of instance.tasks) {
    await archiveTask(task.id, session.user.id);
    await logActivity({
      actorId: session.user.id,
      actorName: session.user.name ?? null,
      entityType: "Task",
      entityId: task.id,
      entityLabel: task.title,
      action: "archived",
      description: `${session.user.name ?? "Someone"} archived task "${task.title}"`,
    });
  }

  await prisma.workflowInstance.delete({ where: { id: instanceId } });

  const instanceLabel = instance.client ? `${instance.name} — ${instance.client.name}` : instance.name;
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "WorkflowInstance",
    entityId: instanceId,
    entityLabel: instanceLabel,
    action: "workflow_deleted",
    description: `${session.user.name ?? "Someone"} deleted workflow "${instanceLabel}" and archived its ${instance.tasks.length} task${instance.tasks.length === 1 ? "" : "s"}`,
  });

  return NextResponse.json({ ok: true });
}
