import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { generateShareToken, hashSharePassword } from "@/lib/share-link";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  password: z.string().trim().min(4).max(200).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { assetId } = await params;
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { clientId: true } });
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  try {
    await requireClientAccess(asset.clientId);
    await requireCapability("canShareAssetsExternally");
  } catch (error) {
    return toErrorResponse(error);
  }

  const links = await prisma.assetShareLink.findMany({
    where: { assetId },
    orderBy: { createdAt: "desc" },
    select: { id: true, token: true, passwordHash: true, expiresAt: true, createdAt: true },
  });

  return NextResponse.json(
    links.map((l) => ({
      id: l.id,
      token: l.token,
      passwordProtected: !!l.passwordHash,
      expiresAt: l.expiresAt,
      createdAt: l.createdAt,
    }))
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { assetId } = await params;
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { clientId: true, title: true } });
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  try {
    await requireClientAccess(asset.clientId);
    await requireCapability("canShareAssetsExternally");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { password, expiresAt } = parsed.data;
  const token = generateShareToken();
  const passwordHash = password ? await hashSharePassword(password) : null;

  const link = await prisma.assetShareLink.create({
    data: {
      assetId,
      token,
      passwordHash,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdById: session.user.id,
    },
  });

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Asset",
    entityId: assetId,
    entityLabel: asset.title,
    action: "share_link_created",
    description: `${session.user.name ?? "Someone"} created a share link for "${asset.title}"`,
  });

  return NextResponse.json(
    {
      id: link.id,
      token: link.token,
      passwordProtected: !!link.passwordHash,
      expiresAt: link.expiresAt,
      createdAt: link.createdAt,
    },
    { status: 201 }
  );
}
