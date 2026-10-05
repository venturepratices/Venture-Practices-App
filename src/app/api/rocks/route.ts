import { NextResponse } from "next/server";

import { LEADERSHIP_MEMBER_WHERE, quarterKeyFor, quarterRange } from "@/lib/leadership";
import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { endOfDay } from "@/lib/utils";
import { createRockSchema } from "@/lib/validations/leadership";

// Quarterly Rocks. Like Issues, deliberately kept out of ActivityLog (see
// src/app/api/issues/route.ts).
export async function POST(request: Request) {
  let userId: string;
  try {
    userId = (await requireCapability("canUseLeadership")).userId;
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = createRockSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const data = parsed.data;
  const owner = await prisma.teamMember.findFirst({ where: { id: data.ownerId, ...LEADERSHIP_MEMBER_WHERE }, select: { id: true } });
  if (!owner) return NextResponse.json({ error: "Rock owners need access to Issues & Rocks." }, { status: 400 });

  const quarter = data.quarter ?? quarterKeyFor();
  const rock = await prisma.rock.create({
    data: {
      title: data.title,
      doneDefinition: data.doneDefinition ?? null,
      quarter,
      dueDate: data.dueDate ? endOfDay(data.dueDate) : quarterRange(quarter).end,
      isCompany: data.isCompany ?? false,
      ownerId: owner.id,
      createdById: userId,
    },
  });
  return NextResponse.json(rock, { status: 201 });
}
