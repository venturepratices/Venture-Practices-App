import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

// A handful of admin-only, app-wide status options — no client scoping, no
// granular capability. Gated the same way Team management is: this config
// affects literally every task in the app, so only admins touch it.

const TONE_VALUES = ["success", "warning", "danger", "neutral", "blue", "violet", "teal", "sky", "slate"] as const;

const createSchema = z.object({
  label: z.string().trim().min(1).max(60),
  tone: z.enum(TONE_VALUES),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const options = await prisma.taskStatusOption.findMany({ orderBy: { sequenceNumber: "asc" } });
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

  const max = await prisma.taskStatusOption.aggregate({ _max: { sequenceNumber: true } });
  const option = await prisma.taskStatusOption.create({
    data: {
      label: parsed.data.label,
      tone: parsed.data.tone,
      sequenceNumber: (max._max.sequenceNumber ?? 0) + 1,
    },
  });

  return NextResponse.json(option, { status: 201 });
}
