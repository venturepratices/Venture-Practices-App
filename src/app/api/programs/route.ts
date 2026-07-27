import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createProgramSchema } from "@/lib/validations/program";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = new URL(request.url).searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  try {
    await requireClientAccess(clientId);
    await requireCapability("canViewDirectMail");
  } catch (error) {
    return toErrorResponse(error);
  }

  const programs = await prisma.program.findMany({
    where: { clientId },
    include: {
      accountManager: { select: { id: true, name: true } },
      campaigns: { orderBy: { sequenceNumber: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(programs);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const clientId = body?.clientId;
  if (!clientId || typeof clientId !== "string") {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  try {
    await requireClientAccess(clientId);
    await requireCapability("canManageDirectMail");
  } catch (error) {
    return toErrorResponse(error);
  }

  const parsed = createProgramSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const program = await prisma.program.create({
    data: {
      clientId,
      name: parsed.data.name,
      product: parsed.data.product ?? "NEW_MOVERS",
      status: parsed.data.status ?? "DRAFT",
      startMonth: new Date(parsed.data.startMonth),
      lengthMonths: parsed.data.lengthMonths ?? 1,
    },
  });

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Program",
    entityId: program.id,
    entityLabel: program.name,
    action: "program_created",
    description: `${session.user.name ?? "Someone"} created the Direct Mail program "${program.name}" for "${client?.name ?? "a client"}"`,
  });

  return NextResponse.json(program, { status: 201 });
}
