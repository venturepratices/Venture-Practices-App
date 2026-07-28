import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { updateWorkflowTemplateSchema } from "@/lib/validations/workflow-template";
import { TEMPLATE_INCLUDE } from "../route";

export async function GET(_request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireCapability("canViewWorkflows");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { templateId } = await params;
  const template = await prisma.workflowTemplate.findUnique({ where: { id: templateId }, include: TEMPLATE_INCLUDE });
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
    await requireCapability("canManageWorkflows");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { templateId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateWorkflowTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const existing = await prisma.workflowTemplate.findUnique({ where: { id: templateId } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (parsed.data.name && parsed.data.name !== existing.name) {
    const nameTaken = await prisma.workflowTemplate.findUnique({ where: { name: parsed.data.name } });
    if (nameTaken) {
      return NextResponse.json({ error: "A template with that name already exists." }, { status: 409 });
    }
  }

  const { stageTemplates, ...rest } = parsed.data;
  const template = await prisma.$transaction(async (tx) => {
    await tx.workflowTemplate.update({
      where: { id: templateId },
      data: rest,
    });

    if (stageTemplates !== undefined) {
      // Full-tree replace: templates are edited rarely by admins, so this is
      // simpler and safer than diffing individual stage/task rows. Cascade
      // deletes WorkflowStageTemplate -> WorkflowTaskTemplate -> assignees.
      // In-flight WorkflowInstances are unaffected (they hold a frozen
      // stagesSnapshot, not a live reference to these rows).
      await tx.workflowStageTemplate.deleteMany({ where: { workflowTemplateId: templateId } });
      for (const [stageIndex, stage] of stageTemplates.entries()) {
        await tx.workflowStageTemplate.create({
          data: {
            workflowTemplateId: templateId,
            name: stage.name,
            description: stage.description ?? null,
            sequenceNumber: stageIndex + 1,
            taskTemplates: {
              create: stage.taskTemplates.map((task, taskIndex) => ({
                title: task.title,
                description: task.description ?? null,
                defaultStatus: task.defaultStatus,
                sequenceNumber: taskIndex + 1,
                defaultAssignees: {
                  create: task.defaultAssigneeIds.map((teamMemberId) => ({ teamMemberId })),
                },
              })),
            },
          },
        });
      }
    }

    return tx.workflowTemplate.findUniqueOrThrow({ where: { id: templateId }, include: TEMPLATE_INCLUDE });
  });

  return NextResponse.json(template);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireCapability("canManageWorkflows");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { templateId } = await params;
  const existing = await prisma.workflowTemplate.findUnique({ where: { id: templateId } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Deleting a template never affects in-flight workflows — instances hold a
  // frozen stagesSnapshot at creation time rather than a live FK back to the
  // template's rows; workflowTemplateId just goes null on the instance.
  await prisma.workflowTemplate.delete({ where: { id: templateId } });

  return NextResponse.json({ ok: true });
}
