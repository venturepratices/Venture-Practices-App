import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { campaignLabel } from "@/lib/campaign-stage";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { spawnCampaignTasks, type TemplateSnapshot } from "@/lib/program-template";

const applyTemplateSchema = z.object({
  templateId: z.string(),
});

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
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
  const parsed = applyTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const template = await prisma.programTemplate.findUnique({
    where: { id: parsed.data.templateId },
    include: { stages: { orderBy: { sequenceNumber: "asc" }, include: { tasks: { orderBy: { sequenceNumber: "asc" } } } } },
  });
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 400 });
  }

  const stagesSnapshot: TemplateSnapshot = template.stages.map((stage) => ({
    stage: stage.stage,
    sequenceNumber: stage.sequenceNumber,
    tasks: stage.tasks.map((task) => ({
      title: task.title,
      description: task.description,
      roleTag: task.roleTag,
      daysBeforeMailDate: task.daysBeforeMailDate,
      sequenceNumber: task.sequenceNumber,
    })),
  }));

  // Role-tagged auto-assignment was removed — spawned tasks always start
  // unassigned; assign people per-task afterward from the campaign page.
  const bindings = { accountManagerId: null, creativeId: null, productionId: null };

  const taskCount = await prisma.$transaction(
    async (tx) => {
      await spawnCampaignTasks(tx, {
        campaignId: campaign.id,
        clientId: campaign.clientId,
        mailDate: campaign.mailDate,
        stagesSnapshot,
        bindings,
      });

      await tx.campaign.update({ where: { id: campaign.id }, data: { stagesSnapshot } });

      return tx.task.count({ where: { campaignId: campaign.id } });
    },
    { timeout: 30000 }
  );

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Campaign",
    entityId: campaign.id,
    entityLabel: `${campaignLabel(campaign)} — ${campaign.client.name}`,
    clientId: campaign.clientId,
    action: "template_applied",
    description: `${session.user.name ?? "Someone"} applied the "${template.name}" template to ${campaignLabel(campaign)} (${campaign.client.name})`,
  });

  return NextResponse.json({ ok: true, taskCount });
}
