import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { restoreArchivedWorkflowInstance } from "@/lib/archive";
import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: Promise<{ archivedInstanceId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await requireCapability("canRestoreArchive");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { archivedInstanceId } = await params;

  const archived = await prisma.archivedWorkflowInstance.findUnique({ where: { id: archivedInstanceId } });
  if (!archived) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const instance = await restoreArchivedWorkflowInstance(archivedInstanceId);

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "WorkflowInstance",
    entityId: instance.id,
    entityLabel: instance.name,
    clientId: instance.clientId,
    action: "workflow_restored",
    description: `${session.user.name ?? "Someone"} restored project "${instance.name}" from the archive (its tasks, if archived, are restored separately from the Tasks archive)`,
  });

  return NextResponse.json(instance, { status: 201 });
}
