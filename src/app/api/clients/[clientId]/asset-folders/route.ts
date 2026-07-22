import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createAssetFolderSchema } from "@/lib/validations/asset-folder";

export async function GET(_request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clientId } = await params;
  try {
    await requireClientAccess(clientId);
    await requireCapability("canViewAssets");
  } catch (error) {
    return toErrorResponse(error);
  }

  const folders = await prisma.assetFolder.findMany({
    where: { clientId },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(folders);
}

export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clientId } = await params;
  try {
    await requireClientAccess(clientId);
    await requireCapability("canManageAssetReviewers");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = createAssetFolderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const folder = await prisma.assetFolder.create({
    data: { clientId, name: parsed.data.name, color: parsed.data.color ?? null },
  });

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: clientId,
    entityLabel: client?.name ?? clientId,
    action: "asset_folder_created",
    description: `${session.user.name ?? "Someone"} created the asset folder "${folder.name}" on "${client?.name ?? "a client"}"`,
  });

  return NextResponse.json(folder, { status: 201 });
}
