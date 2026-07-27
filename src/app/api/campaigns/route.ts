import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { campaignLabel } from "@/lib/campaign-stage";
import { computeCampaignDueDates } from "@/lib/date-math";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createCampaignSchema } from "@/lib/validations/campaign";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = new URL(request.url).searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  try {
    await requireClientAccess(clientId);
    await requireCapability("canViewDirectMail");
  } catch (error) {
    return toErrorResponse(error);
  }

  const campaigns = await prisma.campaign.findMany({
    where: { clientId },
    orderBy: { sequenceNumber: "asc" },
  });

  return NextResponse.json(campaigns);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const clientId = body?.clientId;
  if (!clientId || typeof clientId !== "string") {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  try {
    await requireClientAccess(clientId);
    await requireCapability("canManageDirectMail");
  } catch (error) {
    return toErrorResponse(error);
  }

  const parsed = createCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const mailDate = parsed.data.mailDate ? new Date(parsed.data.mailDate) : null;
  const dueDates = computeCampaignDueDates(mailDate);

  const last = await prisma.campaign.findFirst({
    where: { clientId },
    orderBy: { sequenceNumber: "desc" },
    select: { sequenceNumber: true },
  });

  const campaign = await prisma.campaign.create({
    data: {
      clientId,
      sequenceNumber: (last?.sequenceNumber ?? 0) + 1,
      name: parsed.data.name ?? null,
      mailDate,
      ...dueDates,
      quantity: parsed.data.quantity ?? null,
      geography: parsed.data.geography ?? null,
      budgetCents: parsed.data.budgetCents ?? null,
      offer: parsed.data.offer ?? null,
      cta: parsed.data.cta ?? null,
    },
  });

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Campaign",
    entityId: campaign.id,
    entityLabel: `${campaignLabel(campaign)} — ${client?.name ?? "a client"}`,
    action: "campaign_created",
    description: `${session.user.name ?? "Someone"} added ${campaignLabel(campaign)} for "${client?.name ?? "a client"}"`,
  });

  return NextResponse.json(campaign, { status: 201 });
}
