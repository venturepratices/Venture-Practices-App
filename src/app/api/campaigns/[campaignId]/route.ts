import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
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
      program: { select: { id: true, clientId: true, name: true } },
      tasks: {
        include: { assignee: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await requireClientAccess(campaign.program.clientId);
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
    include: { program: { select: { clientId: true, name: true } } },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await requireClientAccess(campaign.program.clientId);
    await requireCapability("canManageDirectMail");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = updateCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      ...(parsed.data.mailDate !== undefined ? { mailDate: new Date(parsed.data.mailDate) } : {}),
      ...(parsed.data.creativeDueDate !== undefined ? { creativeDueDate: new Date(parsed.data.creativeDueDate) } : {}),
      ...(parsed.data.approvalDueDate !== undefined ? { approvalDueDate: new Date(parsed.data.approvalDueDate) } : {}),
      ...(parsed.data.printDueDate !== undefined ? { printDueDate: new Date(parsed.data.printDueDate) } : {}),
      ...(parsed.data.currentStage !== undefined ? { currentStage: parsed.data.currentStage } : {}),
      ...(parsed.data.quantity !== undefined ? { quantity: parsed.data.quantity } : {}),
      ...(parsed.data.geography !== undefined ? { geography: parsed.data.geography } : {}),
      ...(parsed.data.budgetCents !== undefined ? { budgetCents: parsed.data.budgetCents } : {}),
      ...(parsed.data.offer !== undefined ? { offer: parsed.data.offer } : {}),
      ...(parsed.data.cta !== undefined ? { cta: parsed.data.cta } : {}),
    },
  });

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Campaign",
    entityId: campaign.id,
    entityLabel: `${campaign.program.name} — Campaign #${campaign.sequenceNumber}`,
    action: "campaign_updated",
    description:
      parsed.data.currentStage !== undefined
        ? `${session.user.name ?? "Someone"} advanced campaign #${campaign.sequenceNumber} (${campaign.program.name}) to ${updated.currentStage}`
        : `${session.user.name ?? "Someone"} updated campaign #${campaign.sequenceNumber} (${campaign.program.name})`,
  });

  return NextResponse.json(updated);
}
