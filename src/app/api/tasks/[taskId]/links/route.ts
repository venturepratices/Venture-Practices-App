import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { prisma } from "@/lib/prisma";

const createLinkSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(120),
  url: z.string().trim().url("Enter a valid URL"),
});

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = createLinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const link = await prisma.taskLink.create({
    data: { taskId, label: parsed.data.label, url: parsed.data.url },
  });

  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true } });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Task",
    entityId: taskId,
    entityLabel: task?.title ?? taskId,
    action: "link_added",
    description: `${session.user.name ?? "Someone"} added the link "${parsed.data.label}" to "${task?.title ?? "a task"}"`,
  });

  return NextResponse.json(link, { status: 201 });
}
