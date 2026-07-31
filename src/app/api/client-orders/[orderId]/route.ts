import { NextResponse } from "next/server";

import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;

  const order = await prisma.clientOrder.findUnique({
    where: { id: orderId },
    include: { client: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
  });
  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await requireClientAccess(order.clientId);
    await requireCapability("canViewOrders");
  } catch (error) {
    return toErrorResponse(error);
  }

  return NextResponse.json(order);
}
