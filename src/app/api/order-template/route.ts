import { NextResponse } from "next/server";

import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { updateOrderTemplateSchema } from "@/lib/validations/order-template";

/**
 * Single shared, agency-wide row — lazily created on first read since there's
 * no seed migration for it. Every caller (this route, the create-order route)
 * goes through this helper so there's exactly one place that creates it.
 */
export async function getOrCreateOrderTemplate() {
  const existing = await prisma.orderTemplate.findFirst();
  if (existing) return existing;
  return prisma.orderTemplate.create({ data: { customFields: [] } });
}

export async function GET() {
  try {
    await requireCapability("canViewOrders");
  } catch (error) {
    return toErrorResponse(error);
  }

  const template = await getOrCreateOrderTemplate();
  return NextResponse.json(template);
}

export async function PATCH(request: Request) {
  try {
    await requireCapability("canManageOrders");
  } catch (error) {
    return toErrorResponse(error);
  }

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

  const existing = await getOrCreateOrderTemplate();
  const template = await prisma.orderTemplate.update({
    where: { id: existing.id },
    data: { customFields: parsed.data.customFields },
  });

  return NextResponse.json(template);
}
