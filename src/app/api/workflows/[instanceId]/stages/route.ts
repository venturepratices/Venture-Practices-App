import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { updateWorkflowInstanceStagesSchema } from "@/lib/validations/workflow-instance";
import type { StagesSnapshot } from "@/lib/workflow-instance";

// Full-array replace of a live instance's stagesSnapshot — supports adding a
// stage (append) and renaming one (edit in place); sequenceNumber is always
// recomputed as 1-based array position. Reordering/removing a stage that
// still has live tasks is refused: tasks are tagged with a plain
// workflowStageNumber int, so shuffling stage positions out from under them
// would silently misfile existing work.
export async function PATCH(request: Request, { params }: { params: Promise<{ instanceId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { instanceId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateWorkflowInstanceStagesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const instance = await prisma.workflowInstance.findUnique({
    where: { id: instanceId },
    include: { client: { select: { name: true } }, tasks: { select: { workflowStageNumber: true } } },
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

  const oldSnapshot = instance.stagesSnapshot as StagesSnapshot;
  const newCount = parsed.data.stages.length;
  const removedStageNumbers = oldSnapshot.filter((s) => s.sequenceNumber > newCount).map((s) => s.sequenceNumber);
  if (removedStageNumbers.length > 0) {
    const hasLiveTasks = instance.tasks.some((t) => t.workflowStageNumber !== null && removedStageNumbers.includes(t.workflowStageNumber));
    if (hasLiveTasks) {
      return NextResponse.json(
        { error: "Can't remove a stage that still has tasks — move or delete them first." },
        { status: 400 }
      );
    }
  }

  const newSnapshot: StagesSnapshot = parsed.data.stages.map((stage, index) => ({
    name: stage.name,
    description: stage.description ?? null,
    sequenceNumber: index + 1,
    taskTemplates: [],
  }));

  const updated = await prisma.workflowInstance.update({
    where: { id: instanceId },
    data: { stagesSnapshot: newSnapshot },
  });

  const instanceLabel = instance.client ? `${instance.name} — ${instance.client.name}` : instance.name;
  const addedCount = newCount - oldSnapshot.length;
  if (addedCount > 0) {
    await logActivity({
      actorId: session.user.id,
      actorName: session.user.name ?? null,
      entityType: "WorkflowInstance",
      entityId: instanceId,
      entityLabel: instanceLabel,
      action: "updated",
      description: `${session.user.name ?? "Someone"} added ${addedCount} stage${addedCount === 1 ? "" : "s"} to "${instanceLabel}"`,
    });
  }

  return NextResponse.json(updated);
}
