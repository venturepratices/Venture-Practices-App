import type { AssetStatus } from "@/generated/prisma/enums";
import { notify, notifyChannel } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

/**
 * Asset Approval notification fan-out. Every event type reaches Slack now —
 * uploads/comments are Ambient tier (lighter formatting, digest-eligible
 * once that ships) while decisions/approved/changes-requested are Important
 * or Critical and post instantly. Tier is looked up from the notification
 * type itself (src/lib/notification-tier.ts), not decided per call site.
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
  clientId: string;
  versionNumber: number;
  uploaderId: string | null;
  uploaderName: string | null;
}) {
  const recipientIds = await reviewerTeamMemberIds(params.assetId, params.uploaderId);
  const linkPath = `/clients/${params.clientId}/assets/${params.assetId}`;
  await Promise.all(
    recipientIds.map((recipientId) =>
      notify({
        recipientId,
        type: "ASSET_UPLOADED",
        entityType: "Asset",
        entityId: params.assetId,
        entityLabel: params.assetTitle,
        title: `New version for review: "${params.assetTitle}"`,
        lines: [`v${params.versionNumber} uploaded by ${params.uploaderName ?? "someone"}`],
        linkPath,
      })
    )
  );

  await notifyChannel({
    clientId: params.clientId,
    title: `New file uploaded: "${params.assetTitle}"`,
    lines: [`v${params.versionNumber} by ${params.uploaderName ?? "someone"}`],
    linkPath,
  });
}

export async function notifyAssetCommented(params: {
  assetId: string;
  assetTitle: string;
  clientId: string;
  ownerId: string | null;
  commenterTeamMemberId: string | null;
  commenterName: string | null;
}) {
  const recipients = new Set(await reviewerTeamMemberIds(params.assetId, params.commenterTeamMemberId));
  if (params.ownerId && params.ownerId !== params.commenterTeamMemberId) recipients.add(params.ownerId);
  const linkPath = `/clients/${params.clientId}/assets/${params.assetId}`;

  await Promise.all(
    [...recipients].map((recipientId) =>
      notify({
        recipientId,
        type: "ASSET_COMMENTED",
        entityType: "Asset",
        entityId: params.assetId,
        entityLabel: params.assetTitle,
        title: `New comment: "${params.assetTitle}"`,
        lines: [`By ${params.commenterName ?? "someone"}`],
        linkPath,
      })
    )
  );

  await notifyChannel({
    clientId: params.clientId,
    title: `New comment on asset: "${params.assetTitle}"`,
    lines: [`By ${params.commenterName ?? "someone"}`],
    linkPath,
  });
}

export async function notifyAssetDecided(params: {
  assetId: string;
  assetTitle: string;
  clientId: string;
  ownerId: string | null;
  deciderTeamMemberId: string | null;
  deciderName: string | null;
  decisionLabel: string;
}) {
  const linkPath = `/clients/${params.clientId}/assets/${params.assetId}`;
  if (params.ownerId && params.ownerId !== params.deciderTeamMemberId) {
    await notify({
      recipientId: params.ownerId,
      type: "ASSET_DECIDED",
      entityType: "Asset",
      entityId: params.assetId,
      entityLabel: params.assetTitle,
      title: `Decision submitted: "${params.assetTitle}"`,
      lines: [`${params.deciderName ?? "Someone"} ${params.decisionLabel}`],
      linkPath,
    });
  }

  await notifyChannel({
    clientId: params.clientId,
    title: `Review decision: "${params.assetTitle}"`,
    lines: [`${params.deciderName ?? "Someone"} ${params.decisionLabel}`],
    linkPath,
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
  clientId: string;
  ownerId: string | null;
  status: AssetStatus;
  excludeTeamMemberId?: string | null;
}) {
  if (params.status !== "APPROVED" && params.status !== "CHANGES_REQUESTED") return;

  const recipients = new Set(await reviewerTeamMemberIds(params.assetId, params.excludeTeamMemberId));
  if (params.ownerId && params.ownerId !== params.excludeTeamMemberId) recipients.add(params.ownerId);
  if (recipients.size === 0) return;

  const type = params.status === "APPROVED" ? "ASSET_APPROVED" : "ASSET_CHANGES_REQUESTED";
  const title = params.status === "APPROVED" ? "Asset approved 🎉" : "Asset needs changes";
  const lines =
    params.status === "APPROVED"
      ? [`"${params.assetTitle}" was approved by every reviewer`]
      : [`"${params.assetTitle}" needs changes`, "See the reviewer notes for details"];
  const linkPath = `/clients/${params.clientId}/assets/${params.assetId}`;

  await Promise.all(
    [...recipients].map((recipientId) =>
      notify({
        recipientId,
        type,
        entityType: "Asset",
        entityId: params.assetId,
        entityLabel: params.assetTitle,
        title,
        lines,
        linkPath,
      })
    )
  );

  await notifyChannel({
    clientId: params.clientId,
    title,
    lines: [`Asset: ${params.assetTitle}`],
    linkPath,
  });
}
