import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { notify } from "@/lib/notify";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createClientOrderSchema } from "@/lib/validations/client-order";
import { getOrCreateOrderTemplate } from "@/app/api/order-template/route";
import type { OrderTemplateField } from "@/lib/validations/order-template";

export async function GET(_request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  try {
    await requireClientAccess(clientId);
    await requireCapability("canViewOrders");
  } catch (error) {
    return toErrorResponse(error);
  }

  const orders = await prisma.clientOrder.findMany({
    where: { clientId },
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: { sequenceNumber: "desc" },
  });

  return NextResponse.json(orders);
}

export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clientId } = await params;
  try {
    await requireClientAccess(clientId);
    await requireCapability("canManageOrders");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = createClientOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const latest = await prisma.clientOrder.findFirst({
    where: { clientId },
    orderBy: { sequenceNumber: "desc" },
    select: { sequenceNumber: true },
  });
  const type = latest ? "CHANGE_ORDER" : "ORDER";
  const sequenceNumber = (latest?.sequenceNumber ?? 0) + 1;

  // Never trust client-posted field labels/types — resolve each posted value
  // against the CURRENT template and freeze the whole {key,label,type,value}
  // triple onto the document, so it renders correctly even after the shared
  // template changes later.
  const template = await getOrCreateOrderTemplate();
  const templateFields = template.customFields as unknown as OrderTemplateField[];
  const postedValues = new Map((parsed.data.customFieldValues ?? []).map((v) => [v.key, v.value]));
  const customFieldValues = templateFields.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    value: postedValues.get(field.key) ?? null,
  }));

  const order = await prisma.clientOrder.create({
    data: {
      clientId,
      type,
      sequenceNumber,
      title: parsed.data.title ?? null,
      services: parsed.data.services,
      adBudgetCents: parsed.data.adBudgetCents ?? null,
      notes: parsed.data.notes ?? null,
      customFieldValues,
      createdById: session.user.id,
    },
  });

  const docLabel = type === "ORDER" ? `Order #${sequenceNumber}` : `Change Order #${sequenceNumber}`;
  const linkPath = `/clients/${clientId}/orders/${order.id}`;

  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Client",
    entityId: clientId,
    entityLabel: client.name,
    action: type === "ORDER" ? "order_added" : "order_changed",
    description: `${session.user.name ?? "Someone"} created ${docLabel} for "${client.name}"`,
  });

  const admins = await prisma.teamMember.findMany({ where: { isAdmin: true }, select: { id: true } });
  await Promise.all(
    admins
      .filter((a) => a.id !== session.user.id)
      .map((admin) =>
        notify({
          recipientId: admin.id,
          type: type === "ORDER" ? "ORDER_ADDED" : "ORDER_CHANGED",
          entityType: "ClientOrder",
          entityId: order.id,
          entityLabel: `${docLabel} — ${client.name}`,
          message: `${session.user.name ?? "Someone"} created ${docLabel} for ${client.name}`,
          linkPath,
        })
      )
  );

  return NextResponse.json(order, { status: 201 });
}
