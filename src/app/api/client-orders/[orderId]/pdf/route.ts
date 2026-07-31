import { createElement, type ReactElement } from "react";

import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";

import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { Service } from "@/lib/validations/client-order";
import { OrderPdfDocument, type OrderPdfData } from "@/components/orders/order-pdf-document";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;

  const order = await prisma.clientOrder.findUnique({
    where: { id: orderId },
    include: { client: { select: { name: true } }, createdBy: { select: { name: true } } },
  });
  if (!order) {
    return new Response("Not found", { status: 404 });
  }

  try {
    await requireClientAccess(order.clientId);
    await requireCapability("canViewOrders");
  } catch (error) {
    const errorResponse = toErrorResponse(error);
    return new Response(errorResponse.body, { status: errorResponse.status });
  }

  const data: OrderPdfData = {
    clientName: order.client.name,
    type: order.type,
    sequenceNumber: order.sequenceNumber,
    title: order.title,
    services: order.services as unknown as Service[],
    adBudgetCents: order.adBudgetCents,
    notes: order.notes,
    customFieldValues: order.customFieldValues as unknown as OrderPdfData["customFieldValues"],
    createdByName: order.createdBy?.name ?? null,
    createdAt: order.createdAt,
  };

  // OrderPdfDocument is a component that renders a <Document>, not a
  // <Document> element itself — renderToBuffer's type only accepts the
  // latter, though it works with any element tree that resolves to one at
  // render time (react-pdf's own docs use custom wrapper components this
  // way), so the cast reflects a real runtime-safe usage, not a type escape.
  const element = createElement(OrderPdfDocument, { order: data }) as unknown as ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(element);
  const docLabel = order.type === "ORDER" ? `Order-${order.sequenceNumber}` : `Change-Order-${order.sequenceNumber}`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${docLabel}-${order.client.name.replace(/[^a-z0-9]+/gi, "-")}.pdf"`,
    },
  });
}
