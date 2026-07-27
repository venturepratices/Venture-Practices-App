import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createProgramTemplateSchema } from "@/lib/validations/program-template";

const TEMPLATE_INCLUDE = {
  stages: {
    orderBy: { sequenceNumber: "asc" as const },
    include: { tasks: { orderBy: { sequenceNumber: "asc" as const } } },
  },
};

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireCapability("canViewDirectMail");
  } catch (error) {
    return toErrorResponse(error);
  }

  const templates = await prisma.programTemplate.findMany({
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
    await requireCapability("canManageDirectMail");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = createProgramTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const template = await prisma.programTemplate.create({
    data: {
      name: parsed.data.name,
      product: parsed.data.product ?? null,
      stages: {
        create: parsed.data.stages.map((stage, stageIndex) => ({
          stage: stage.stage,
          sequenceNumber: stageIndex + 1,
          tasks: {
            create: stage.tasks.map((task, taskIndex) => ({
              title: task.title,
              roleTag: task.roleTag,
              daysBeforeMailDate: task.daysBeforeMailDate ?? null,
              sequenceNumber: taskIndex + 1,
            })),
          },
        })),
      },
    },
    include: TEMPLATE_INCLUDE,
  });

  return NextResponse.json(template, { status: 201 });
}
