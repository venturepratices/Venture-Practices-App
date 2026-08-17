import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { updateWorkflowTemplateFolderSchema } from "@/lib/validations/workflow-template-folder";

export async function PATCH(request: Request, { params }: { params: Promise<{ folderId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireCapability("canManageWorkflows");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { folderId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateWorkflowTemplateFolderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const existing = await prisma.workflowTemplateFolder.findUnique({ where: { id: folderId } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const folder = await prisma.workflowTemplateFolder.update({ where: { id: folderId }, data: parsed.data });
  return NextResponse.json(folder);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ folderId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireCapability("canManageWorkflows");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { folderId } = await params;
  const existing = await prisma.workflowTemplateFolder.findUnique({ where: { id: folderId } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Templates inside survive — folderId is SetNull, so they fall back to
  // "All templates" rather than being deleted with the folder.
  await prisma.workflowTemplateFolder.delete({ where: { id: folderId } });
  return NextResponse.json({ ok: true });
}
