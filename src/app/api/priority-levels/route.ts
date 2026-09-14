import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

// Same shape and gating as src/app/api/task-statuses/route.ts — a handful of
// admin-only, app-wide options, no client scoping, no granular capability.

const HEX_COLOR = z.string().trim().regex(/^#[0-9a-f]{6}$/i, "Must be a hex color like #2563eb");

const createSchema = z.object({
  label: z.string().trim().min(1).max(60),
  color: HEX_COLOR,
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const options = await prisma.priorityLevelOption.findMany({ orderBy: { sequenceNumber: "asc" } });
  return NextResponse.json(options);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireAdmin();
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const max = await prisma.priorityLevelOption.aggregate({ _max: { sequenceNumber: true } });
  const option = await prisma.priorityLevelOption.create({
    data: {
      label: parsed.data.label,
      color: parsed.data.color,
      sequenceNumber: (max._max.sequenceNumber ?? 0) + 1,
    },
  });

  return NextResponse.json(option, { status: 201 });
}
