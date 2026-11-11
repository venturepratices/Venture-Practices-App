import { NextResponse } from "next/server";

import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ archivedCampaignId: string }> }) {
  // Staff with archive access only. A client-portal login or a removed staff
  // member has no team member row, so gets a 401 before anything is looked up.
  try {
    await requireCapability("canViewArchive");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { archivedCampaignId } = await params;
  const archivedCampaign = await prisma.archivedCampaign.findUnique({
    where: { id: archivedCampaignId },
    include: { deletedBy: { select: { name: true } } },
  });

  if (!archivedCampaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (archivedCampaign.clientId) {
    try {
      await requireClientAccess(archivedCampaign.clientId);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  return NextResponse.json(archivedCampaign);
}
