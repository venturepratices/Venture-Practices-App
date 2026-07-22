import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { recomputeAssetStatus } from "@/lib/asset-status";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: Request, { params }: { params: Promise<{ reviewerId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { reviewerId } = await params;
  const reviewer = await prisma.assetReviewer.findUnique({
    where: { id: reviewerId },
    include: {
      asset: { select: { id: true, clientId: true, title: true } },
      teamMember: { select: { name: true } },
    },
  });
  if (!reviewer) return NextResponse.json({ error: "Reviewer not found" }, { status: 404 });

  try {
    await requireClientAccess(reviewer.asset.clientId);
    await requireCapability("canManageAssetReviewers");
  } catch (error) {
    return toErrorResponse(error);
  }

  await prisma.assetReviewer.delete({ where: { id: reviewerId } });
  await recomputeAssetStatus(reviewer.asset.id);

  const reviewerName = reviewer.teamMember?.name ?? reviewer.guestName ?? "a reviewer";
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Asset",
    entityId: reviewer.asset.id,
    entityLabel: reviewer.asset.title,
    action: "reviewer_removed",
    description: `${session.user.name ?? "Someone"} removed ${reviewerName} from "${reviewer.asset.title}"`,
  });

  return NextResponse.json({ ok: true });
}
