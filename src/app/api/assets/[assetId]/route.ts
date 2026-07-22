import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { AssetStatus } from "@/generated/prisma/enums";
import { logActivity } from "@/lib/activity-log";
import { recomputeAssetStatus } from "@/lib/asset-status";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({ action: z.enum(["archive", "reopen"]) });

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
