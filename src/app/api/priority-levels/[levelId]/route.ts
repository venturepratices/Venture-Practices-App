import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

// Same shape as src/app/api/task-statuses/[statusId]/route.ts, minus the
// isComplete-protection branch — no priority level is wired into anything
// that requires protecting one from being edited or deleted.

const HEX_COLOR = z.string().trim().regex(/^#[0-9a-f]{6}$/i, "Must be a hex color like #2563eb");

const patchSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  color: HEX_COLOR.optional(),
  sequenceNumber: z.number().int().min(1).optional(),
});

const deleteSchema = z.object({ replacementId: z.string().min(1).nullable().optional() });

export async function PATCH(request: Request, { params }: { params: Promise<{ levelId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireAdmin();
  } catch (error) {
    return toErrorResponse(error);
  }

  const { levelId } = await params;
  const option = await prisma.priorityLevelOption.findUnique({ where: { id: levelId } });
  if (!option) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const updated = await prisma.priorityLevelOption.update({ where: { id: levelId }, data: parsed.data });
  return NextResponse.json(updated);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ levelId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireAdmin();
  } catch (error) {
    return toErrorResponse(error);
  }

  const { levelId } = await params;
  const option = await prisma.priorityLevelOption.findUnique({ where: { id: levelId } });
  if (!option) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const tasksInUse = await prisma.task.count({ where: { priorityLevelId: levelId } });
  const replacementId = parsed.data.replacementId ?? null;

  if (tasksInUse > 0) {
    if (!replacementId) {
      return NextResponse.json(
        {
          error: `${tasksInUse} task${tasksInUse === 1 ? "" : "s"} still use this priority level. Pick a replacement to move them to first.`,
          tasksInUse,
        },
        { status: 400 },
      );
    }
    if (replacementId === levelId) {
      return NextResponse.json({ error: "Replacement must be a different priority level." }, { status: 400 });
    }
    const replacement = await prisma.priorityLevelOption.findUnique({ where: { id: replacementId } });
    if (!replacement) {
      return NextResponse.json({ error: "Replacement priority level not found." }, { status: 400 });
    }
  }

  await prisma.$transaction(async (tx) => {
    if (replacementId) {
      await tx.task.updateMany({ where: { priorityLevelId: levelId }, data: { priorityLevelId: replacementId } });
    }
    await tx.priorityLevelOption.delete({ where: { id: levelId } });
  });

  return NextResponse.json({ ok: true });
}
