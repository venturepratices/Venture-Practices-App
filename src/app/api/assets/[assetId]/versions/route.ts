import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { AssetKind } from "@/generated/prisma/enums";
import { assetKindFromMimeType } from "@/lib/asset-kind";
import { logActivity } from "@/lib/activity-log";
import { recomputeAssetStatus } from "@/lib/asset-status";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const versionSchema = z.union([
  z.object({
    kind: z.literal("upload"),
    blobUrl: z.string().url(),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("url"), externalUrl: z.string().url() }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { assetId } = await params;
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { versionNumber: true } } },
  });
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  try {
    await requireClientAccess(asset.clientId);
    await requireCapability("canUploadAssets");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = versionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const v = parsed.data;
  const versionData =
    v.kind === "upload"
      ? { kind: assetKindFromMimeType(v.mimeType), blobUrl: v.blobUrl, mimeType: v.mimeType, sizeBytes: v.sizeBytes }
      : { kind: AssetKind.WEBSITE, externalUrl: v.externalUrl };

  const nextVersionNumber = (asset.versions[0]?.versionNumber ?? 0) + 1;
  const version = await prisma.assetVersion.create({
    data: { assetId, versionNumber: nextVersionNumber, uploadedById: session.user.id, ...versionData },
  });

  // Decisions/comments are always scoped to the version they were made on, so
  // a brand-new version naturally starts with zero of both — this recompute
  // just discovers that and flips the asset back to IN_REVIEW.
  await recomputeAssetStatus(assetId);
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Asset",
    entityId: assetId,
    entityLabel: asset.title,
    action: "version_uploaded",
    description: `${session.user.name ?? "Someone"} uploaded v${nextVersionNumber} of "${asset.title}"`,
  });

  return NextResponse.json(version, { status: 201 });
}
