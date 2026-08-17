import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createWorkflowTemplateFolderSchema } from "@/lib/validations/workflow-template-folder";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireCapability("canManageWorkflows");
  } catch (error) {
    return toErrorResponse(error);
  }

  const folders = await prisma.workflowTemplateFolder.findMany({
    include: { _count: { select: { templates: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(folders);
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
  const parsed = createWorkflowTemplateFolderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const folder = await prisma.workflowTemplateFolder.create({
    data: { name: parsed.data.name, color: parsed.data.color ?? null },
  });
  return NextResponse.json(folder, { status: 201 });
}
