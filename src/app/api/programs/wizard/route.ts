import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { computeCampaignDueDates } from "@/lib/date-math";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { spawnCampaignTasks, type TemplateSnapshot } from "@/lib/program-template";
import { createProgramWizardSchema } from "@/lib/validations/program-wizard";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createProgramWizardSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const input = parsed.data;

  try {
    await requireClientAccess(input.clientId);
    await requireCapability("canManageDirectMail");
  } catch (error) {
    return toErrorResponse(error);
  }

  let stagesSnapshot: TemplateSnapshot = [];
  if (input.templateId) {
    const template = await prisma.programTemplate.findUnique({
      where: { id: input.templateId },
      include: { stages: { orderBy: { sequenceNumber: "asc" }, include: { tasks: { orderBy: { sequenceNumber: "asc" } } } } },
    });
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 400 });
    }
    stagesSnapshot = template.stages.map((stage) => ({
      stage: stage.stage,
      sequenceNumber: stage.sequenceNumber,
      tasks: stage.tasks.map((task) => ({
        title: task.title,
        roleTag: task.roleTag,
        daysBeforeMailDate: task.daysBeforeMailDate,
        sequenceNumber: task.sequenceNumber,
      })),
    }));
  }

  // Role-tagged auto-assignment (Account Manager / Creative / Production) was
  // removed — spawned tasks always start unassigned; assign people per-task
  // afterward from the campaign page.
  const bindings = { accountManagerId: null, creativeId: null, productionId: null };

  const startMonth = new Date(input.startMonth);

  const result = await prisma.$transaction(async (tx) => {
    const program = await tx.program.create({
      data: {
        clientId: input.clientId,
        name: input.name,
        product: input.product,
        status: "ACTIVE",
        startMonth,
        lengthMonths: input.lengthMonths,
        templateSnapshot: stagesSnapshot.length > 0 ? stagesSnapshot : undefined,
      },
    });

    const campaigns = [];
    for (let i = 0; i < input.lengthMonths; i++) {
      const mailDate = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, input.mailDayOfMonth);
      const dueDates = computeCampaignDueDates(mailDate);

      const campaign = await tx.campaign.create({
        data: {
          programId: program.id,
          sequenceNumber: i + 1,
          mailDate,
          ...dueDates,
          quantity: input.quantity,
          budgetCents: input.budgetCents,
          geography: input.geography,
          offer: input.offer,
          cta: input.cta,
          stagesSnapshot: stagesSnapshot.length > 0 ? stagesSnapshot : undefined,
        },
      });
      campaigns.push(campaign);

      if (stagesSnapshot.length > 0) {
        await spawnCampaignTasks(tx, {
          programId: program.id,
          campaignId: campaign.id,
          clientId: input.clientId,
          mailDate,
          stagesSnapshot,
          bindings,
        });
      }
    }

    const taskCount = await tx.task.count({ where: { programId: program.id } });

    return { program, campaignCount: campaigns.length, taskCount };
  }, { timeout: 30000 });

  const client = await prisma.client.findUnique({ where: { id: input.clientId }, select: { name: true } });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Program",
    entityId: result.program.id,
    entityLabel: result.program.name,
    action: "program_created",
    description: `${session.user.name ?? "Someone"} ran the Campaign Generator wizard for "${result.program.name}" (${client?.name ?? "a client"}) — ${result.campaignCount} campaigns, ${result.taskCount} tasks`,
  });

  return NextResponse.json(result, { status: 201 });
}
