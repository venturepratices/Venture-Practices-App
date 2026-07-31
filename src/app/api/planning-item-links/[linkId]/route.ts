import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: Request, { params }: { params: Promise<{ linkId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { linkId } = await params;
  const link = await prisma.planningItemLink.findUnique({
    where: { id: linkId },
    include: { planningItem: { select: { title: true, clientId: true } } },
  });
  if (!link) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await requireClientAccess(link.planningItem.clientId);
    await requireCapability("canManagePlanning");
  } catch (error) {
    return toErrorResponse(error);
  }

  await prisma.planningItemLink.delete({ where: { id: linkId } });

  const client = await prisma.client.findUnique({ where: { id: link.planningItem.clientId }, select: { name: true } });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: link.planningItem.clientId,
    entityLabel: client?.name ?? link.planningItem.clientId,
    action: "planning_item_link_removed",
    description: `${session.user.name ?? "Someone"} removed the link "${link.label}" from the planning idea "${link.planningItem.title}"`,
  });

  return NextResponse.json({ ok: true });
}
