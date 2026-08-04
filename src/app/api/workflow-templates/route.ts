import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createWorkflowTemplateSchema } from "@/lib/validations/workflow-template";

export const TEMPLATE_INCLUDE = {
  stageTemplates: {
    orderBy: { sequenceNumber: "asc" as const },
    include: {
      taskTemplates: {
        orderBy: { sequenceNumber: "asc" as const },
        include: {
          defaultAssignees: { include: { teamMember: { select: { id: true, name: true } } } },
          links: { orderBy: { createdAt: "asc" as const } },
        },
      },
    },
  },
};

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireCapability("canViewWorkflows");
  } catch (error) {
    return toErrorResponse(error);
  }

  const templates = await prisma.workflowTemplate.findMany({
    include: TEMPLATE_INCLUDE,
    orderBy: { name: "asc" },
  });

  return NextResponse.json(templates);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireCapability("canManageWorkflows");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = createWorkflowTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const existing = await prisma.workflowTemplate.findUnique({ where: { name: parsed.data.name } });
  if (existing) {
    return NextResponse.json({ error: "A template with that name already exists." }, { status: 409 });
  }

  const template = await prisma.workflowTemplate.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      stageTemplates: {
        create: parsed.data.stageTemplates.map((stage, stageIndex) => ({
          name: stage.name,
          description: stage.description ?? null,
          sequenceNumber: stageIndex + 1,
          taskTemplates: {
            create: stage.taskTemplates.map((task, taskIndex) => ({
              title: task.title,
              description: task.description ?? null,
              defaultStatus: task.defaultStatus,
              defaultStatusId: task.defaultStatus,
              sequenceNumber: taskIndex + 1,
              defaultAssignees: {
                create: task.defaultAssigneeIds.map((teamMemberId) => ({ teamMemberId })),
              },
              links: {
                create: task.links.map((link) => ({ url: link.url, label: link.label })),
              },
            })),
          },
        })),
      },
    },
    include: TEMPLATE_INCLUDE,
  });

  return NextResponse.json(template, { status: 201 });
}
