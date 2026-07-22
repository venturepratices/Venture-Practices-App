import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { updateAssetFolderSchema } from "@/lib/validations/asset-folder";

export async function PATCH(request: Request, { params }: { params: Promise<{ folderId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { folderId } = await params;
  const folder = await prisma.assetFolder.findUnique({
    where: { id: folderId },
    include: { client: { select: { name: true } } },
  });
  if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });

  try {
    await requireClientAccess(folder.clientId);
    await requireCapability("canManageAssetReviewers");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = updateAssetFolderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const updated = await prisma.assetFolder.update({
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
    action: "asset_folder_renamed",
    description: `${session.user.name ?? "Someone"} renamed the asset folder "${folder.name}" to "${updated.name}" on "${folder.client.name}"`,
  });

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ folderId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { folderId } = await params;
  const folder = await prisma.assetFolder.findUnique({
    where: { id: folderId },
    include: { client: { select: { name: true } } },
  });
  if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });

  try {
    await requireClientAccess(folder.clientId);
    await requireCapability("canManageAssetReviewers");
  } catch (error) {
    return toErrorResponse(error);
  }

  // Assets inside fall back to "All assets" (onDelete: SetNull on Asset.folderId) — never deleted.
  await prisma.assetFolder.delete({ where: { id: folderId } });

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: folder.clientId,
    entityLabel: folder.client.name,
    action: "asset_folder_deleted",
    description: `${session.user.name ?? "Someone"} deleted the asset folder "${folder.name}" on "${folder.client.name}"`,
  });

  return NextResponse.json({ ok: true });
}
