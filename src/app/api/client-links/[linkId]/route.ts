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
  const link = await prisma.clientLink.findUnique({ where: { id: linkId }, include: { client: { select: { name: true } } } });
  if (!link) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await requireClientAccess(link.clientId);
    await requireCapability("canManageClientLinks");
  } catch (error) {
    return toErrorResponse(error);
  }
  await prisma.clientLink.delete({ where: { id: linkId } });

  {
    await logActivity({
      actorId: session.user.id,
      actorName: session.user.name ?? null,
      entityType: "Client",
      entityId: link.clientId,
      entityLabel: link.client.name,
      action: "link_removed",
      description: `${session.user.name ?? "Someone"} removed the link "${link.label}" from "${link.client.name}"`,
    });
  }

  return NextResponse.json({ ok: true });
}
