import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { AssetStatus } from "@/generated/prisma/enums";
import { logActivity } from "@/lib/activity-log";
import { recomputeAssetStatus } from "@/lib/asset-status";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const patchSchema = z.union([
  z.object({ action: z.enum(["archive", "reopen"]) }),
  z.object({ folderId: z.string().min(1).nullable() }),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { assetId } = await params;
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { clientId: true, title: true } });
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  try {
    await requireClientAccess(asset.clientId);
    await requireCapability("canManageAssetReviewers");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  if ("action" in parsed.data) {
    if (parsed.data.action === "archive") {
      await prisma.asset.update({ where: { id: assetId }, data: { status: AssetStatus.ARCHIVED } });
    } else {
      // Un-archive, then let the normal derivation take back over immediately
      // (so reopening a fully-approved asset doesn't wrongly sit at IN_REVIEW).
      await prisma.asset.update({ where: { id: assetId }, data: { status: AssetStatus.IN_REVIEW } });
      await recomputeAssetStatus(assetId);
    }

    await logActivity({
      actorId: session.user.id,
      actorName: session.user.name ?? null,
      entityType: "Asset",
      entityId: assetId,
      entityLabel: asset.title,
      action: parsed.data.action === "archive" ? "archived" : "reopened",
      description: `${session.user.name ?? "Someone"} ${parsed.data.action === "archive" ? "archived" : "reopened"} "${asset.title}"`,
    });

    return NextResponse.json({ ok: true });
  }

  // Move to a folder (or back to "All assets" when folderId is null) —
  // verify the folder actually belongs to this asset's own client so a move
  // can never reach across clients.
  let folderName: string | null = null;
  if (parsed.data.folderId) {
    const folder = await prisma.assetFolder.findUnique({ where: { id: parsed.data.folderId }, select: { clientId: true, name: true } });
    if (!folder || folder.clientId !== asset.clientId) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    folderName = folder.name;
  }

  await prisma.asset.update({ where: { id: assetId }, data: { folderId: parsed.data.folderId } });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Asset",
    entityId: assetId,
    entityLabel: asset.title,
    action: "moved_to_folder",
    description: folderName
      ? `${session.user.name ?? "Someone"} moved "${asset.title}" to the "${folderName}" folder`
      : `${session.user.name ?? "Someone"} moved "${asset.title}" out of its folder`,
  });

  return NextResponse.json({ ok: true });
}
