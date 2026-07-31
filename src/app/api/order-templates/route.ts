import { NextResponse } from "next/server";

import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createOrderTemplateSchema } from "@/lib/validations/order-template";

export async function GET() {
  try {
    await requireCapability("canViewOrders");
  } catch (error) {
    return toErrorResponse(error);
  }

  const templates = await prisma.orderTemplate.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(templates);
}

export async function POST(request: Request) {
  try {
    await requireCapability("canManageOrders");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = createOrderTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const template = await prisma.orderTemplate
    .create({ data: { name: parsed.data.name, customFields: [] } })
    .catch((error: { code?: string }) => {
      if (error?.code === "P2002") return null;
      throw error;
    });

  if (!template) {
    return NextResponse.json({ error: "A template with that name already exists." }, { status: 409 });
  }

  return NextResponse.json(template, { status: 201 });
}
