import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createPlanningItemLinkSchema } from "@/lib/validations/planning";

export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
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
  const parsed = createPlanningItemLinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const link = await prisma.planningItemLink.create({
    data: { planningItemId: itemId, label: parsed.data.label, url: parsed.data.url },
  });

  const client = await prisma.client.findUnique({ where: { id: item.clientId }, select: { name: true } });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: item.clientId,
    entityLabel: client?.name ?? item.clientId,
    clientId: item.clientId,
    action: "planning_item_link_added",
    description: `${session.user.name ?? "Someone"} added the link "${link.label}" to the planning idea "${item.title}"`,
  });

  return NextResponse.json(link, { status: 201 });
}
