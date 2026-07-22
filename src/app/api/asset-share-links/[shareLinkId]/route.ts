import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: Request, { params }: { params: Promise<{ shareLinkId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { shareLinkId } = await params;
  const link = await prisma.assetShareLink.findUnique({
    where: { id: shareLinkId },
    include: { asset: { select: { id: true, clientId: true, title: true } } },
  });
  if (!link) return NextResponse.json({ error: "Link not found" }, { status: 404 });

  try {
    await requireClientAccess(link.asset.clientId);
    await requireCapability("canShareAssetsExternally");
  } catch (error) {
    return toErrorResponse(error);
  }

  // Revoking is a hard delete — the token stops resolving immediately for
  // anyone holding the link, with no separate "revoked" flag to fall out of sync.
  await prisma.assetShareLink.delete({ where: { id: shareLinkId } });

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Asset",
    entityId: link.asset.id,
    entityLabel: link.asset.title,
    action: "share_link_revoked",
    description: `${session.user.name ?? "Someone"} revoked a share link for "${link.asset.title}"`,
  });

  return NextResponse.json({ ok: true });
}
