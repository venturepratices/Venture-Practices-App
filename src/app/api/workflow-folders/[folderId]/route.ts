import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { updateWorkflowFolderSchema } from "@/lib/validations/workflow-folder";

export async function PATCH(request: Request, { params }: { params: Promise<{ folderId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { folderId } = await params;
  const folder = await prisma.workflowFolder.findUnique({
    where: { id: folderId },
    include: { client: { select: { name: true } } },
  });
  if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });

  try {
    await requireClientAccess(folder.clientId);
    await requireCapability("canManageWorkflows");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = updateWorkflowFolderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const updated = await prisma.workflowFolder.update({
    where: { id: folderId },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.color !== undefined ? { color: parsed.data.color } : {}),
    },
  });

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: folder.clientId,
    entityLabel: folder.client.name,
    action: "workflow_folder_renamed",
    description: `${session.user.name ?? "Someone"} renamed the workflow folder "${folder.name}" to "${updated.name}" on "${folder.client.name}"`,
  });

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ folderId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { folderId } = await params;
  const folder = await prisma.workflowFolder.findUnique({
    where: { id: folderId },
    include: { client: { select: { name: true } } },
  });
  if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });

  try {
    await requireClientAccess(folder.clientId);
    await requireCapability("canManageWorkflows");
  } catch (error) {
    return toErrorResponse(error);
  }

  // Workflows inside fall back to "All workflows" (onDelete: SetNull on
  // WorkflowInstance.folderId) — never deleted.
  await prisma.workflowFolder.delete({ where: { id: folderId } });

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: folder.clientId,
    entityLabel: folder.client.name,
    action: "workflow_folder_deleted",
    description: `${session.user.name ?? "Someone"} deleted the workflow folder "${folder.name}" on "${folder.client.name}"`,
  });

  return NextResponse.json({ ok: true });
}
