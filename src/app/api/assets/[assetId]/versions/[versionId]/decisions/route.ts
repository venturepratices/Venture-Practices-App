import { NextResponse } from "next/server";
import { z } from "zod";

import { AssetDecisionValue } from "@/generated/prisma/enums";
import { logActivity } from "@/lib/activity-log";
import { notifyAssetDecided, notifyAssetStatusChanged } from "@/lib/asset-notify";
import { recomputeAssetStatus } from "@/lib/asset-status";
import { resolveAssetActor, toErrorResponse } from "@/lib/permissions";
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

/**
 * Accepts either a TeamMember session (canDecideOnAssets, must already be an
 * assigned reviewer — unchanged Slice 3 behavior) or a ClientUser session
 * (their own client, non-draft asset — lazily made a reviewer on first
 * decision, since it makes no sense to require staff to "assign" a client as
 * reviewer before they can approve their own asset).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ assetId: string; versionId: string }> }
) {
  const { assetId, versionId } = await params;
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true } } },
  });
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  let actor;
  try {
    actor = await resolveAssetActor(asset, "canDecideOnAssets");
  } catch (error) {
    return toErrorResponse(error);
  }

  if (asset.versions[0]?.id !== versionId) {
    return NextResponse.json({ error: "Decisions can only be made on the latest version." }, { status: 400 });
  }

  let reviewer = await prisma.assetReviewer.findFirst({ where: { assetId, ...actor.reviewerWhere } });
  if (!reviewer) {
    if ("clientUserId" in actor.reviewerWhere) {
      reviewer = await prisma.assetReviewer.create({ data: { assetId, ...actor.reviewerWhere } });
    } else {
      return NextResponse.json({ error: "You're not an assigned reviewer on this asset." }, { status: 403 });
    }
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
    actorId: actor.actorId,
    actorName: actor.actorName,
    entityType: "Asset",
    entityId: assetId,
    entityLabel: asset.title,
    action: "decision_made",
    description: `${actor.actorName ?? "Someone"} ${decisionLabel(parsed.data.decision).toLowerCase()} "${asset.title}"`,
  });
  await notifyAssetDecided({
    assetId,
    assetTitle: asset.title,
    ownerId: asset.createdById,
    deciderTeamMemberId: actor.actorId,
    deciderName: actor.actorName,
    decisionLabel: decisionLabel(parsed.data.decision).toLowerCase(),
  });
  if (status !== asset.status) {
    await notifyAssetStatusChanged({
      assetId,
      assetTitle: asset.title,
      ownerId: asset.createdById,
      status,
      excludeTeamMemberId: actor.actorId,
    });
  }

  return NextResponse.json({ decision, status }, { status: 200 });
}
