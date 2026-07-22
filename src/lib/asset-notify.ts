import type { AssetStatus } from "@/generated/prisma/enums";
import { notify, postToSlack } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

/**
 * Asset Approval notification fan-out (Slice 5). Every in-app Notification
 * row here is written with `slack: false` — Slack posts for these
 * high-volume events (uploads/comments/decisions) are skipped entirely to
 * avoid spamming the channel; only a genuine headline moment (the asset's
 * overall status flipping to APPROVED or CHANGES_REQUESTED, via
 * notifyAssetStatusChanged) posts to Slack, and only ONCE per event — not
 * once per recipient — via a direct postToSlack() call.
 *
 * Only TeamMember reviewers/owners can receive an in-app Notification
 * (Notification.recipientId has an FK to TeamMember); ClientUser and guest
 * reviewers have no notification inbox in this prototype (see the Slice 4b
 * scope note) and are simply never included as recipients here.
 */

async function reviewerTeamMemberIds(assetId: string, exclude?: string | null): Promise<string[]> {
  const reviewers = await prisma.assetReviewer.findMany({
    where: { assetId, teamMemberId: { not: null } },
    select: { teamMemberId: true },
  });
  const ids = new Set<string>();
  for (const r of reviewers) {
    if (r.teamMemberId && r.teamMemberId !== exclude) ids.add(r.teamMemberId);
  }
  return [...ids];
}

export async function notifyAssetUploaded(params: {
  assetId: string;
  assetTitle: string;
  versionNumber: number;
  uploaderId: string | null;
  uploaderName: string | null;
}) {
  const recipientIds = await reviewerTeamMemberIds(params.assetId, params.uploaderId);
  await Promise.all(
    recipientIds.map((recipientId) =>
      notify({
        recipientId,
        type: "ASSET_UPLOADED",
        entityType: "Asset",
        entityId: params.assetId,
        entityLabel: params.assetTitle,
        message: `${params.uploaderName ?? "Someone"} uploaded v${params.versionNumber} of "${params.assetTitle}" for your review`,
        slack: false,
      })
    )
  );
}

export async function notifyAssetCommented(params: {
  assetId: string;
  assetTitle: string;
  ownerId: string | null;
  commenterTeamMemberId: string | null;
  commenterName: string | null;
}) {
  const recipients = new Set(await reviewerTeamMemberIds(params.assetId, params.commenterTeamMemberId));
  if (params.ownerId && params.ownerId !== params.commenterTeamMemberId) recipients.add(params.ownerId);

  await Promise.all(
    [...recipients].map((recipientId) =>
      notify({
        recipientId,
        type: "ASSET_COMMENTED",
        entityType: "Asset",
        entityId: params.assetId,
        entityLabel: params.assetTitle,
        message: `${params.commenterName ?? "Someone"} commented on "${params.assetTitle}"`,
        slack: false,
      })
    )
  );
}

export async function notifyAssetDecided(params: {
  assetId: string;
  assetTitle: string;
  ownerId: string | null;
  deciderTeamMemberId: string | null;
  deciderName: string | null;
  decisionLabel: string;
}) {
  if (!params.ownerId || params.ownerId === params.deciderTeamMemberId) return;
  await notify({
    recipientId: params.ownerId,
    type: "ASSET_DECIDED",
    entityType: "Asset",
    entityId: params.assetId,
    entityLabel: params.assetTitle,
    message: `${params.deciderName ?? "Someone"} ${params.decisionLabel} "${params.assetTitle}"`,
    slack: false,
  });
}

/**
 * Fires only when `status` just became APPROVED or CHANGES_REQUESTED — the
 * two "headline" moments worth a Slack post, per the plan. Notifies the
 * owner + every TeamMember reviewer (excluding whoever's action triggered
 * the flip) in-app, and posts to Slack exactly once for the whole event.
 */
export async function notifyAssetStatusChanged(params: {
  assetId: string;
  assetTitle: string;
  ownerId: string | null;
  status: AssetStatus;
  excludeTeamMemberId?: string | null;
}) {
  if (params.status !== "APPROVED" && params.status !== "CHANGES_REQUESTED") return;

  const recipients = new Set(await reviewerTeamMemberIds(params.assetId, params.excludeTeamMemberId));
  if (params.ownerId && params.ownerId !== params.excludeTeamMemberId) recipients.add(params.ownerId);
  if (recipients.size === 0) return;

  const type = params.status === "APPROVED" ? "ASSET_APPROVED" : "ASSET_CHANGES_REQUESTED";
  const message =
    params.status === "APPROVED"
      ? `"${params.assetTitle}" was approved by every reviewer`
      : `"${params.assetTitle}" needs changes — see the reviewer notes`;

  await Promise.all(
    [...recipients].map((recipientId) =>
      notify({
        recipientId,
        type,
        entityType: "Asset",
        entityId: params.assetId,
        entityLabel: params.assetTitle,
        message,
        slack: false,
      })
    )
  );
  await postToSlack(message);
}
