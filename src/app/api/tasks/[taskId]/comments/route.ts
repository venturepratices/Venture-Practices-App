import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

const createCommentSchema = z.object({
  body: z.string().trim().min(1, "Comment can't be empty").max(4000),
});

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = createCommentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const comment = await prisma.comment.create({
    data: { taskId, authorId: session.user.id, body: parsed.data.body },
    include: { author: { select: { id: true, name: true } } },
  });

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { title: true, assigneeId: true, assignee: { select: { name: true } } },
  });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Task",
    entityId: taskId,
    entityLabel: task?.title ?? taskId,
    action: "commented",
    description: `${session.user.name ?? "Someone"} commented on "${task?.title ?? "a task"}"`,
  });

  // Plain-text @Full Name matching — no mention autocomplete UI exists yet,
  // so this is a simple substring scan against team member names.
  const teamMembers = await prisma.teamMember.findMany({ select: { id: true, name: true } });
  const mentionedIds = new Set<string>();
  const lowerBody = parsed.data.body.toLowerCase();
  for (const member of teamMembers) {
    if (member.id === session.user.id) continue;
    if (!lowerBody.includes(`@${member.name.toLowerCase()}`)) continue;
    mentionedIds.add(member.id);
    await notify({
      recipientId: member.id,
      type: "MENTIONED",
      entityType: "Task",
      entityId: taskId,
      entityLabel: task?.title ?? taskId,
      message: `${member.name} — ${session.user.name ?? "someone"} mentioned you in a comment on "${task?.title ?? "a task"}"`,
    });
  }

  if (task?.assigneeId && task.assigneeId !== session.user.id && !mentionedIds.has(task.assigneeId)) {
    await notify({
      recipientId: task.assigneeId,
      type: "COMMENTED",
      entityType: "Task",
      entityId: taskId,
      entityLabel: task.title,
      message: `${task.assignee?.name ?? "Someone"} — ${session.user.name ?? "someone"} commented on "${task.title}"`,
    });
  }

  return NextResponse.json(comment, { status: 201 });
}
