import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { recomputeAssetStatus } from "@/lib/asset-status";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const addReviewerSchema = z.union([
  z.object({ teamMemberId: z.string().min(1) }),
  z.object({ guestEmail: z.string().trim().toLowerCase().email(), guestName: z.string().trim().min(1).max(100) }),
]);

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
    await requireCapability("canManageAssetReviewers");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = addReviewerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const data = parsed.data;

  const existing =
    "teamMemberId" in data
      ? await prisma.assetReviewer.findFirst({ where: { assetId, teamMemberId: data.teamMemberId } })
      : await prisma.assetReviewer.findFirst({ where: { assetId, guestEmail: data.guestEmail } });
  if (existing) {
    return NextResponse.json({ error: "Already a reviewer on this asset." }, { status: 409 });
  }

  const reviewer = await prisma.assetReviewer.create({
    data:
      "teamMemberId" in data
        ? { assetId, teamMemberId: data.teamMemberId }
        : { assetId, guestEmail: data.guestEmail, guestName: data.guestName },
    include: { teamMember: { select: { id: true, name: true } } },
  });

  await recomputeAssetStatus(assetId);

  const reviewerName = reviewer.teamMember?.name ?? reviewer.guestName ?? "a reviewer";
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Asset",
    entityId: assetId,
    entityLabel: asset.title,
    action: "reviewer_added",
    description: `${session.user.name ?? "Someone"} added ${reviewerName} as a reviewer on "${asset.title}"`,
  });

  return NextResponse.json(reviewer, { status: 201 });
}
