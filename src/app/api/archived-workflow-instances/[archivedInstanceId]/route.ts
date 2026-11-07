import { NextResponse } from "next/server";

import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ archivedInstanceId: string }> }) {
  // Staff with archive access only. A client-portal login or a removed staff
  // member has no team member row, so gets a 401 before anything is looked up.
  try {
    await requireCapability("canViewArchive");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { archivedInstanceId } = await params;
  const archivedInstance = await prisma.archivedWorkflowInstance.findUnique({
    where: { id: archivedInstanceId },
    include: { deletedBy: { select: { name: true } } },
  });

  if (!archivedInstance) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // An internal (no-client) project is open to everyone with archive access,
  // as it is to all staff with project access while live.
  if (archivedInstance.clientId) {
    try {
      await requireClientAccess(archivedInstance.clientId);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  return NextResponse.json(archivedInstance);
}
