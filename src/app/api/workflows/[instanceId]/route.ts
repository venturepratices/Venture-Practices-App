import { NextResponse } from "next/server";
import { z } from "zod";

import { archiveWorkflowInstance } from "@/lib/archive";
import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({ folderId: z.string().min(1).nullable() });

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

// Move to a folder (or back to "All workflows" when folderId is null).
// Internal (no-client) workflows have no folders — see the WorkflowFolder
// schema comment for why folders are deliberately per-client only.
export async function PATCH(request: Request, { params }: { params: Promise<{ instanceId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { instanceId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const instance = await prisma.workflowInstance.findUnique({ where: { id: instanceId }, select: { clientId: true, name: true } });
  if (!instance) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await requireCapability("canManageWorkflows");
    if (instance.clientId) await requireClientAccess(instance.clientId);
  } catch (error) {
    return toErrorResponse(error);
  }

  let folderName: string | null = null;
  if (parsed.data.folderId) {
    if (!instance.clientId) {
      return NextResponse.json({ error: "Internal projects can't be filed into a folder." }, { status: 400 });
    }
    const folder = await prisma.workflowFolder.findUnique({ where: { id: parsed.data.folderId }, select: { clientId: true, name: true } });
    if (!folder || folder.clientId !== instance.clientId) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    folderName = folder.name;
  }

  const updated = await prisma.workflowInstance.update({ where: { id: instanceId }, data: { folderId: parsed.data.folderId } });

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "WorkflowInstance",
    entityId: instanceId,
    entityLabel: instance.name,
    clientId: instance.clientId,
    action: "moved_to_folder",
    description: folderName
      ? `${session.user.name ?? "Someone"} moved "${instance.name}" to the "${folderName}" folder`
      : `${session.user.name ?? "Someone"} moved "${instance.name}" out of its folder`,
  });

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ instanceId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { instanceId } = await params;
  const instance = await prisma.workflowInstance.findUnique({
    where: { id: instanceId },
    include: { client: { select: { name: true } }, tasks: { select: { id: true, title: true, clientId: true } } },
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
  // workflow spawned is archived via archiveTask() (same as the single-task
  // delete route), and now the instance row itself is archived too, instead
  // of being a permanent hard delete. Both recoverable from /archive.
  await archiveWorkflowInstance(instanceId, session.user.id);
  for (const task of instance.tasks) {
    await logActivity({
      actorId: session.user.id,
      actorName: session.user.name ?? null,
      entityType: "Task",
      entityId: task.id,
      entityLabel: task.title,
      clientId: task.clientId,
      action: "archived",
      description: `${session.user.name ?? "Someone"} archived task "${task.title}"`,
    });
  }

  const instanceLabel = instance.client ? `${instance.name} — ${instance.client.name}` : instance.name;
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "WorkflowInstance",
    entityId: instanceId,
    entityLabel: instanceLabel,
    clientId: instance.clientId,
    action: "workflow_deleted",
    description: `${session.user.name ?? "Someone"} archived project "${instanceLabel}" and its ${instance.tasks.length} task${instance.tasks.length === 1 ? "" : "s"}`,
  });

  return NextResponse.json({ ok: true });
}
