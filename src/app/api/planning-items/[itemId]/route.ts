import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { updatePlanningItemSchema } from "@/lib/validations/planning";

export async function GET(_request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { itemId } = await params;
  const item = await prisma.planningItem.findUnique({
    where: { id: itemId },
    include: { createdBy: { select: { id: true, name: true } }, links: { orderBy: { createdAt: "asc" } } },
  });
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await requireClientAccess(item.clientId);
    await requireCapability("canViewPlanning");
  } catch (error) {
    return toErrorResponse(error);
  }

  return NextResponse.json(item);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { itemId } = await params;
  const item = await prisma.planningItem.findUnique({ where: { id: itemId } });
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await requireClientAccess(item.clientId);
    await requireCapability("canManagePlanning");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = updatePlanningItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  // A converted idea's status is owned by the convert route (it also has to
  // create the real task) — block flipping it back via this generic PATCH.
  // Other fields (e.g. moving it between folders) stay editable regardless.
  if (item.status === "CONVERTED" && parsed.data.status) {
    return NextResponse.json({ error: "This idea has already been converted to a task." }, { status: 400 });
  }

  const updated = await prisma.planningItem.update({
    where: { id: itemId },
    data: parsed.data,
    include: { createdBy: { select: { id: true, name: true } } },
  });

  if (parsed.data.status && parsed.data.status !== item.status) {
    const client = await prisma.client.findUnique({ where: { id: item.clientId }, select: { name: true } });
    await logActivity({
      actorId: session.user.id,
      actorName: session.user.name ?? null,
      entityType: "Client",
      entityId: item.clientId,
      entityLabel: client?.name ?? item.clientId,
      clientId: item.clientId,
      action: "planning_item_updated",
      description: `${session.user.name ?? "Someone"} moved planning idea "${updated.title}" to ${parsed.data.status}`,
    });
  }

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { itemId } = await params;
  const item = await prisma.planningItem.findUnique({ where: { id: itemId } });
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await requireClientAccess(item.clientId);
    await requireCapability("canManagePlanning");
  } catch (error) {
    return toErrorResponse(error);
  }

  await prisma.planningItem.delete({ where: { id: itemId } });

  const client = await prisma.client.findUnique({ where: { id: item.clientId }, select: { name: true } });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: item.clientId,
    entityLabel: client?.name ?? item.clientId,
    action: "planning_item_deleted",
    description: `${session.user.name ?? "Someone"} deleted planning idea "${item.title}"`,
  });

  return NextResponse.json({ ok: true });
}
