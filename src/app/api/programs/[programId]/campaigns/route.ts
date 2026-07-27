import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { computeCampaignDueDates } from "@/lib/date-math";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createCampaignSchema } from "@/lib/validations/campaign";

export async function GET(_request: Request, { params }: { params: Promise<{ programId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { programId } = await params;
  const program = await prisma.program.findUnique({ where: { id: programId } });
  if (!program) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await requireClientAccess(program.clientId);
    await requireCapability("canViewDirectMail");
  } catch (error) {
    return toErrorResponse(error);
  }

  const campaigns = await prisma.campaign.findMany({
    where: { programId },
    orderBy: { sequenceNumber: "asc" },
  });

  return NextResponse.json(campaigns);
}

export async function POST(request: Request, { params }: { params: Promise<{ programId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { programId } = await params;
  const program = await prisma.program.findUnique({ where: { id: programId } });
  if (!program) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await requireClientAccess(program.clientId);
    await requireCapability("canManageDirectMail");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = createCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const mailDate = new Date(parsed.data.mailDate);
  const dueDates = computeCampaignDueDates(mailDate);

  const last = await prisma.campaign.findFirst({
    where: { programId },
    orderBy: { sequenceNumber: "desc" },
    select: { sequenceNumber: true },
  });

  const campaign = await prisma.campaign.create({
    data: {
      programId,
      sequenceNumber: (last?.sequenceNumber ?? 0) + 1,
      mailDate,
      ...dueDates,
      quantity: parsed.data.quantity ?? null,
      geography: parsed.data.geography ?? null,
      budgetCents: parsed.data.budgetCents ?? null,
      offer: parsed.data.offer ?? null,
      cta: parsed.data.cta ?? null,
    },
  });

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Campaign",
    entityId: campaign.id,
    entityLabel: `${program.name} — Campaign #${campaign.sequenceNumber}`,
    action: "campaign_created",
    description: `${session.user.name ?? "Someone"} added campaign #${campaign.sequenceNumber} to "${program.name}"`,
  });

  return NextResponse.json(campaign, { status: 201 });
}
