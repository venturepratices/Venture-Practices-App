import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: Promise<{ instanceId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { instanceId } = await params;
  const instance = await prisma.workflowInstance.findUnique({
    where: { id: instanceId },
    include: { client: { select: { name: true } } },
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

  if (instance.status !== "ACTIVE") {
    return NextResponse.json({ error: "Only an active project can be cancelled." }, { status: 400 });
  }

  // Cancelling detaches every task (workflowInstanceId/workflowStageNumber
  // cleared) but leaves them otherwise untouched — they keep existing as
  // normal tasks, just no longer part of a workflow. The instance row itself
  // is kept (status: CANCELLED) as a historical record, not deleted.
  await prisma.$transaction([
    prisma.task.updateMany({
      where: { workflowInstanceId: instanceId },
      data: { workflowInstanceId: null, workflowStageNumber: null },
    }),
    prisma.workflowInstance.update({ where: { id: instanceId }, data: { status: "CANCELLED" } }),
  ]);

  const instanceLabel = instance.client ? `${instance.name} — ${instance.client.name}` : instance.name;
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "WorkflowInstance",
    entityId: instanceId,
    entityLabel: instanceLabel,
    clientId: instance.clientId,
    action: "workflow_cancelled",
    description: `${session.user.name ?? "Someone"} cancelled project "${instanceLabel}"`,
  });

  return NextResponse.json({ ok: true });
}
