import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ archivedTaskId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { archivedTaskId } = await params;
  const archivedTask = await prisma.archivedTask.findUnique({
    where: { id: archivedTaskId },
    include: { deletedBy: { select: { name: true } } },
  });

  if (!archivedTask) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(archivedTask);
}
