import { NextResponse } from "next/server";

import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { updateOrderTemplateSchema } from "@/lib/validations/order-template";

export async function GET(_request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    await requireCapability("canViewOrders");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { templateId } = await params;
  const template = await prisma.orderTemplate.findUnique({ where: { id: templateId } });
  if (!template) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(template);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    await requireCapability("canManageOrders");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { templateId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateOrderTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  // Keys must be unique so a create-order submission can unambiguously match
  // a posted value back to its field definition.
  const keys = parsed.data.customFields.map((f) => f.key);
  if (new Set(keys).size !== keys.length) {
    return NextResponse.json({ error: "Field keys must be unique" }, { status: 400 });
  }

  const existing = await prisma.orderTemplate.findUnique({ where: { id: templateId } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const template = await prisma.orderTemplate.update({
    where: { id: templateId },
    data: { customFields: parsed.data.customFields },
  });

  return NextResponse.json(template);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    await requireCapability("canManageOrders");
  } catch (error) {
    return toErrorResponse(error);
  }

  const { templateId } = await params;
  const existing = await prisma.orderTemplate.findUnique({ where: { id: templateId } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.orderTemplate.delete({ where: { id: templateId } });
  return NextResponse.json({ ok: true });
}
