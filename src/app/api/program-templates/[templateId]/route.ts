import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { updateProgramTemplateSchema } from "@/lib/validations/program-template";

const TEMPLATE_INCLUDE = {
  stages: {
    orderBy: { sequenceNumber: "asc" as const },
    include: { tasks: { orderBy: { sequenceNumber: "asc" as const } } },
  },
};

export async function GET(_request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireCapability("canViewDirectMail");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { templateId } = await params;
  const template = await prisma.programTemplate.findUnique({ where: { id: templateId }, include: TEMPLATE_INCLUDE });
  if (!template) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(template);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireCapability("canManageDirectMail");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { templateId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateProgramTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const existing = await prisma.programTemplate.findUnique({ where: { id: templateId } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { stages, ...rest } = parsed.data;
  const template = await prisma.$transaction(async (tx) => {
    await tx.programTemplate.update({
      where: { id: templateId },
      data: rest,
    });

    if (stages !== undefined) {
      // Full-tree replace: templates are edited rarely by admins, so this is
      // simpler and safer than diffing individual stage/task rows. Cascade
      // deletes StageTemplate -> TaskTemplate.
      await tx.stageTemplate.deleteMany({ where: { templateId } });
      for (const [stageIndex, stage] of stages.entries()) {
        await tx.stageTemplate.create({
          data: {
            templateId,
            stage: stage.stage,
            sequenceNumber: stageIndex + 1,
            tasks: {
              create: stage.tasks.map((task, taskIndex) => ({
                title: task.title,
                description: task.description ?? null,
                roleTag: task.roleTag,
                daysBeforeMailDate: task.daysBeforeMailDate ?? null,
                sequenceNumber: taskIndex + 1,
              })),
            },
          },
        });
      }
    }

    return tx.programTemplate.findUniqueOrThrow({ where: { id: templateId }, include: TEMPLATE_INCLUDE });
  });

  return NextResponse.json(template);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireCapability("canManageDirectMail");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { templateId } = await params;
  const existing = await prisma.programTemplate.findUnique({ where: { id: templateId } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Deleting a template never affects in-flight programs — the wizard copies
  // its contents into Program.templateSnapshot/Campaign.stagesSnapshot at
  // creation time rather than holding a live FK back to the template.
  await prisma.programTemplate.delete({ where: { id: templateId } });

  return NextResponse.json({ ok: true });
}
