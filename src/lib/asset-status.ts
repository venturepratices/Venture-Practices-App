import { AssetDecisionValue, AssetStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

const APPROVED_LIKE: AssetDecisionValue[] = [AssetDecisionValue.APPROVED, AssetDecisionValue.APPROVED_WITH_CHANGES];

/**
 * Derives review status from one version's reviewer decisions. Approve-with-
 * changes counts toward "everyone signed off" — it's an approval with a note,
 * not a block. A single Changes Requested always wins regardless of how many
 * others approved.
 */
export function computeVersionStatus(
  reviewerCount: number,
  decisions: { decision: AssetDecisionValue }[]
): AssetStatus {
  if (decisions.some((d) => d.decision === AssetDecisionValue.CHANGES_REQUESTED)) {
    return AssetStatus.CHANGES_REQUESTED;
  }
  if (reviewerCount > 0 && decisions.length >= reviewerCount && decisions.every((d) => APPROVED_LIKE.includes(d.decision))) {
    return AssetStatus.APPROVED;
  }
  return AssetStatus.IN_REVIEW;
}

/**
 * Recomputes and persists an asset's overall status from its latest
 * version's reviewer decisions. Call after any reviewer/decision/version
 * change. Never touches an ARCHIVED asset — archiving is a manual, owner-only
 * action that a decision recompute must not silently undo.
 */
export async function recomputeAssetStatus(assetId: string): Promise<AssetStatus> {
  const asset = await prisma.asset.findUniqueOrThrow({
    where: { id: assetId },
    include: {
      reviewers: { select: { id: true } },
      versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true } },
    },
  });
  if (asset.status === AssetStatus.ARCHIVED) return asset.status;

  const latestVersion = asset.versions[0];
  const decisions = latestVersion
    ? await prisma.assetDecision.findMany({ where: { versionId: latestVersion.id }, select: { decision: true } })
    : [];

  const status = computeVersionStatus(asset.reviewers.length, decisions);
  if (status !== asset.status) {
    await prisma.asset.update({ where: { id: assetId }, data: { status } });
  }
  return status;
}
