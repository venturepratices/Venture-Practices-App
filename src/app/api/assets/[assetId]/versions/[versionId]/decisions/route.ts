import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { AssetDecisionValue } from "@/generated/prisma/enums";
import { logActivity } from "@/lib/activity-log";
import { recomputeAssetStatus } from "@/lib/asset-status";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const decisionSchema = z.object({
  decision: z.enum([AssetDecisionValue.APPROVED, AssetDecisionValue.APPROVED_WITH_CHANGES, AssetDecisionValue.CHANGES_REQUESTED]),
  note: z.string().trim().max(2000).optional().nullable(),
});

function decisionLabel(v: AssetDecisionValue): string {
  switch (v) {
    case AssetDecisionValue.APPROVED:
      return "Approved";
    case AssetDecisionValue.APPROVED_WITH_CHANGES:
      return "Approved with changes";
    case AssetDecisionValue.CHANGES_REQUESTED:
      return "Requested changes on";
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ assetId: string; versionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { assetId, versionId } = await params;
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true } } },
  });
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  try {
    await requireClientAccess(asset.clientId);
    await requireCapability("canDecideOnAssets");
  } catch (error) {
    return toErrorResponse(error);
  }

  if (asset.versions[0]?.id !== versionId) {
    return NextResponse.json({ error: "Decisions can only be made on the latest version." }, { status: 400 });
  }

  const reviewer = await prisma.assetReviewer.findFirst({ where: { assetId, teamMemberId: session.user.id } });
  if (!reviewer) {
    return NextResponse.json({ error: "You're not an assigned reviewer on this asset." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const decision = await prisma.assetDecision.upsert({
    where: { versionId_reviewerId: { versionId, reviewerId: reviewer.id } },
    create: { versionId, reviewerId: reviewer.id, decision: parsed.data.decision, note: parsed.data.note ?? null },
    update: { decision: parsed.data.decision, note: parsed.data.note ?? null, decidedAt: new Date() },
  });

  const status = await recomputeAssetStatus(assetId);
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Asset",
    entityId: assetId,
    entityLabel: asset.title,
    action: "decision_made",
    description: `${session.user.name ?? "Someone"} ${decisionLabel(parsed.data.decision).toLowerCase()} "${asset.title}"`,
  });

  return NextResponse.json({ decision, status }, { status: 200 });
}
