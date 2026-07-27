import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { campaignLabel } from "@/lib/campaign-stage";
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
        include: { assignees: { include: { teamMember: { select: { id: true, name: true } } } } },
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
    },
  });

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Campaign",
    entityId: campaign.id,
    entityLabel: `${campaign.program.name} — ${campaignLabel(updated)}`,
    action: "campaign_updated",
    description:
      parsed.data.currentStage !== undefined
        ? `${session.user.name ?? "Someone"} advanced ${campaignLabel(updated)} (${campaign.program.name}) to ${updated.currentStage}`
        : `${session.user.name ?? "Someone"} updated ${campaignLabel(updated)} (${campaign.program.name})`,
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

  // Tasks survive the campaign's deletion (Task.campaignId is nullable) —
  // explicitly clear campaignId/campaignStage rather than relying on the
  // DB's ON DELETE SET NULL, since that wouldn't also clear campaignStage.
  await prisma.task.updateMany({ where: { campaignId }, data: { campaignId: null, campaignStage: null } });
  await prisma.campaign.delete({ where: { id: campaignId } });

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Campaign",
    entityId: campaign.id,
    entityLabel: `${campaign.program.name} — ${campaignLabel(campaign)}`,
    action: "campaign_deleted",
    description: `${session.user.name ?? "Someone"} deleted ${campaignLabel(campaign)} from "${campaign.program.name}"`,
  });

  return NextResponse.json({ ok: true });
}
