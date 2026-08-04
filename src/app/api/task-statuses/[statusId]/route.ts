import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const TONE_VALUES = ["success", "warning", "danger", "neutral", "blue", "violet", "teal", "sky", "slate"] as const;

const patchSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  tone: z.enum(TONE_VALUES).optional(),
  sequenceNumber: z.number().int().min(1).optional(),
});

const deleteSchema = z.object({ replacementId: z.string().min(1).nullable().optional() });

export async function PATCH(request: Request, { params }: { params: Promise<{ statusId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireAdmin();
  } catch (error) {
    return toErrorResponse(error);
  }

  const { statusId } = await params;
  const option = await prisma.taskStatusOption.findUnique({ where: { id: statusId } });
  if (!option) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (option.isComplete) {
    return NextResponse.json(
      { error: "This status is wired into workflow completion and can't be changed." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const updated = await prisma.taskStatusOption.update({ where: { id: statusId }, data: parsed.data });
  return NextResponse.json(updated);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ statusId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requireAdmin();
  } catch (error) {
    return toErrorResponse(error);
  }

  const { statusId } = await params;
  const option = await prisma.taskStatusOption.findUnique({ where: { id: statusId } });
  if (!option) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (option.isComplete) {
    return NextResponse.json(
      { error: "This status is wired into workflow completion and can't be deleted." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const tasksInUse = await prisma.task.count({ where: { statusId } });
  const replacementId = parsed.data.replacementId ?? null;

  if (tasksInUse > 0) {
    if (!replacementId) {
      return NextResponse.json(
        { error: `${tasksInUse} task${tasksInUse === 1 ? "" : "s"} still use this status. Pick a replacement to move them to first.`, tasksInUse },
        { status: 400 },
      );
    }
    if (replacementId === statusId) {
      return NextResponse.json({ error: "Replacement must be a different status." }, { status: 400 });
    }
    const replacement = await prisma.taskStatusOption.findUnique({ where: { id: replacementId } });
    if (!replacement) {
      return NextResponse.json({ error: "Replacement status not found." }, { status: 400 });
    }
  }

  await prisma.$transaction(async (tx) => {
    if (replacementId) {
      await tx.task.updateMany({ where: { statusId }, data: { statusId: replacementId } });
      await tx.workflowTaskTemplate.updateMany({ where: { defaultStatusId: statusId }, data: { defaultStatusId: replacementId } });
    }
    await tx.taskStatusOption.delete({ where: { id: statusId } });
  });

  return NextResponse.json({ ok: true });
}
