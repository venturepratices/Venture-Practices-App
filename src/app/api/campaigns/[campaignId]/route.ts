import { NextResponse } from "next/server";

import { archiveCampaign } from "@/lib/archive";
import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { campaignLabel } from "@/lib/campaign-stage";
import { maybeCompleteApprovalTasksForProofAsset } from "@/lib/campaign-advance";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { updateCampaignSchema } from "@/lib/validations/campaign";

export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { campaignId } = await params;
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      client: { select: { id: true, name: true } },
      tasks: {
        include: { assignees: { include: { teamMember: { select: { id: true, name: true } } } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await requireClientAccess(campaign.clientId);
    await requireCapability("canViewDirectMail");
  } catch (error) {
    return toErrorResponse(error);
  }

  return NextResponse.json(campaign);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { campaignId } = await params;
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { client: { select: { id: true, name: true } } },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await requireClientAccess(campaign.clientId);
    await requireCapability("canManageDirectMail");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = updateCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  // Linking a proof asset: it must belong to this campaign's own client —
  // prevents linking another client's asset by guessing/probing an id.
  let linkedAsset: { status: string } | null = null;
  if (parsed.data.proofAssetId) {
    linkedAsset = await prisma.asset.findFirst({
      where: { id: parsed.data.proofAssetId, clientId: campaign.clientId },
      select: { status: true },
    });
    if (!linkedAsset) {
      return NextResponse.json({ error: "That asset doesn't belong to this client." }, { status: 400 });
    }
  }

  let updated;
  try {
    updated = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name?.trim() || null } : {}),
        ...(parsed.data.mailDate !== undefined ? { mailDate: parsed.data.mailDate ? new Date(parsed.data.mailDate) : null } : {}),
        ...(parsed.data.creativeDueDate !== undefined
          ? { creativeDueDate: parsed.data.creativeDueDate ? new Date(parsed.data.creativeDueDate) : null }
          : {}),
        ...(parsed.data.approvalDueDate !== undefined
          ? { approvalDueDate: parsed.data.approvalDueDate ? new Date(parsed.data.approvalDueDate) : null }
          : {}),
        ...(parsed.data.printDueDate !== undefined ? { printDueDate: parsed.data.printDueDate ? new Date(parsed.data.printDueDate) : null } : {}),
        ...(parsed.data.currentStage !== undefined ? { currentStage: parsed.data.currentStage } : {}),
        ...(parsed.data.quantity !== undefined ? { quantity: parsed.data.quantity } : {}),
        ...(parsed.data.geography !== undefined ? { geography: parsed.data.geography } : {}),
        ...(parsed.data.budgetCents !== undefined ? { budgetCents: parsed.data.budgetCents } : {}),
        ...(parsed.data.offer !== undefined ? { offer: parsed.data.offer } : {}),
        ...(parsed.data.cta !== undefined ? { cta: parsed.data.cta } : {}),
        ...(parsed.data.proofAssetId !== undefined ? { proofAssetId: parsed.data.proofAssetId } : {}),
      },
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "That asset is already linked to another campaign." }, { status: 409 });
    }
    throw error;
  }

  // Edge case: linking an asset that's already APPROVED (approved before the
  // link existed, so recomputeAssetStatus never re-fires) — complete the
  // Approval-stage tasks now instead of waiting for another decision.
  if (parsed.data.proofAssetId && linkedAsset?.status === "APPROVED") {
    await maybeCompleteApprovalTasksForProofAsset(parsed.data.proofAssetId, session.user.id);
  }

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Campaign",
    entityId: campaign.id,
    entityLabel: `${campaignLabel(updated)} — ${campaign.client.name}`,
    clientId: campaign.clientId,
    action: "campaign_updated",
    description:
      parsed.data.currentStage !== undefined
        ? `${session.user.name ?? "Someone"} advanced ${campaignLabel(updated)} (${campaign.client.name}) to ${updated.currentStage}`
        : `${session.user.name ?? "Someone"} updated ${campaignLabel(updated)} (${campaign.client.name})`,
  });

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { campaignId } = await params;
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { client: { select: { id: true, name: true } } },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await requireClientAccess(campaign.clientId);
    await requireCapability("canManageDirectMail");
  } catch (error) {
    return toErrorResponse(error);
  }

  // Tasks survive the campaign's deletion, unattached but live (Task.campaignId
  // is nullable — archiveCampaign clears campaignId/campaignStage on them).
  // The campaign row itself is archived, not hard-deleted — recoverable from
  // /archive like every other delete in this app.
  await archiveCampaign(campaignId, session.user.id);

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Campaign",
    entityId: campaign.id,
    entityLabel: `${campaignLabel(campaign)} — ${campaign.client.name}`,
    clientId: campaign.clientId,
    action: "campaign_deleted",
    description: `${session.user.name ?? "Someone"} archived ${campaignLabel(campaign)} for "${campaign.client.name}"`,
  });

  return NextResponse.json({ ok: true });
}
