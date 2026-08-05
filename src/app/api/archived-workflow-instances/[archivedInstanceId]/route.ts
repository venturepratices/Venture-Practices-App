import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ archivedInstanceId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { archivedInstanceId } = await params;
  const archivedInstance = await prisma.archivedWorkflowInstance.findUnique({
    where: { id: archivedInstanceId },
    include: { deletedBy: { select: { name: true } } },
  });

  if (!archivedInstance) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(archivedInstance);
}
