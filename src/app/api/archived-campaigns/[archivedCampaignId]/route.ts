import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ archivedCampaignId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { archivedCampaignId } = await params;
  const archivedCampaign = await prisma.archivedCampaign.findUnique({
    where: { id: archivedCampaignId },
    include: { deletedBy: { select: { name: true } } },
  });

  if (!archivedCampaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(archivedCampaign);
}
