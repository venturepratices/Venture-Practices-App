import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { updateProgramSchema } from "@/lib/validations/program";

export async function GET(_request: Request, { params }: { params: Promise<{ programId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { programId } = await params;
  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      client: { select: { id: true, name: true } },
      campaigns: { orderBy: { sequenceNumber: "asc" } },
      tasks: {
        where: { campaignId: null },
        include: { assignees: { include: { teamMember: { select: { id: true, name: true } } } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!program) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await requireClientAccess(program.clientId);
    await requireCapability("canViewDirectMail");
  } catch (error) {
    return toErrorResponse(error);
  }

  return NextResponse.json(program);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ programId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { programId } = await params;
  const program = await prisma.program.findUnique({ where: { id: programId } });
  if (!program) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await requireClientAccess(program.clientId);
    await requireCapability("canManageDirectMail");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = updateProgramSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const updated = await prisma.program.update({
    where: { id: programId },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.product !== undefined ? { product: parsed.data.product } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.startMonth !== undefined ? { startMonth: new Date(parsed.data.startMonth) } : {}),
      ...(parsed.data.lengthMonths !== undefined ? { lengthMonths: parsed.data.lengthMonths } : {}),
    },
  });

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Program",
    entityId: program.id,
    entityLabel: updated.name,
    action: "program_updated",
    description: `${session.user.name ?? "Someone"} updated the Direct Mail program "${updated.name}"`,
  });

  return NextResponse.json(updated);
}
