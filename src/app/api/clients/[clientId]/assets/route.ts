import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { AssetKind } from "@/generated/prisma/enums";
import { assetKindFromMimeType } from "@/lib/asset-kind";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const versionSchema = z.union([
  // Uploaded file (bytes already in Vercel Blob after browser upload completed).
  z.object({
    kind: z.literal("upload"),
    blobUrl: z.string().url(),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
  }),
  // Pasted URL (website / landing page — no bytes stored, kind = WEBSITE).
  z.object({
    kind: z.literal("url"),
    externalUrl: z.string().url(),
  }),
]);

const createAssetSchema = z.object({
  title: z.string().trim().min(1, "Title required").max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
  version: versionSchema,
});

export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clientId } = await params;
  try {
    await requireClientAccess(clientId);
    await requireCapability("canUploadAssets");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = createAssetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { title, description, dueDate, version } = parsed.data;

  const versionData =
    version.kind === "upload"
      ? {
          kind: assetKindFromMimeType(version.mimeType),
          blobUrl: version.blobUrl,
          mimeType: version.mimeType,
          sizeBytes: version.sizeBytes,
        }
      : { kind: AssetKind.WEBSITE, externalUrl: version.externalUrl };

  const asset = await prisma.asset.create({
    data: {
      clientId,
      title,
      description: description ?? null,
      dueDate: dueDate ? new Date(dueDate) : null,
      createdById: session.user.id,
      versions: {
        create: {
          versionNumber: 1,
          uploadedById: session.user.id,
          ...versionData,
        },
      },
    },
    include: { versions: true },
  });

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Asset",
    entityId: asset.id,
    entityLabel: asset.title,
    action: "uploaded",
    description: `${session.user.name ?? "Someone"} uploaded asset "${asset.title}" for ${client?.name ?? "a client"}`,
  });

  return NextResponse.json(asset, { status: 201 });
}
