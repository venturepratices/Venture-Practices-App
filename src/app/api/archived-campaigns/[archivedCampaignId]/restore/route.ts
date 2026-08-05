import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { restoreArchivedCampaign } from "@/lib/archive";
import { campaignLabel } from "@/lib/campaign-stage";
import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: Promise<{ archivedCampaignId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await requireCapability("canRestoreArchive");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { archivedCampaignId } = await params;

  const archived = await prisma.archivedCampaign.findUnique({ where: { id: archivedCampaignId } });
  if (!archived) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let campaign;
  try {
    campaign = await restoreArchivedCampaign(archivedCampaignId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Restore failed." }, { status: 400 });
  }

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Campaign",
    entityId: campaign.id,
    entityLabel: `${campaignLabel(campaign)} — ${archived.clientName ?? "Unknown client"}`,
    clientId: campaign.clientId,
    action: "campaign_restored",
    description: `${session.user.name ?? "Someone"} restored ${campaignLabel(campaign)} from the archive`,
  });

  return NextResponse.json(campaign, { status: 201 });
}
