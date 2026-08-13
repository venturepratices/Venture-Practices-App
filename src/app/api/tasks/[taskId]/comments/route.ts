import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { notify, notifyChannel } from "@/lib/notify";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

function excerpt(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

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

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      title: true,
      clientId: true,
      isPrivate: true,
      workflowInstanceId: true,
      assignees: { select: { teamMemberId: true, teamMember: { select: { id: true, name: true, email: true, slackUserId: true } } } },
    },
  });
  if (!task) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const linkPath = task.workflowInstanceId
    ? task.clientId
      ? `/clients/${task.clientId}/workflows/${task.workflowInstanceId}?taskId=${taskId}`
      : `/workflows/${task.workflowInstanceId}?taskId=${taskId}`
    : task.clientId
      ? `/clients/${task.clientId}/tasks?taskId=${taskId}`
      : `/tasks?taskId=${taskId}`;
  // Commenting on a client task requires access to that client, in addition
  // to the comment-on-tasks capability.
  try {
    await requireCapability("canCommentOnTasks");
    if (task.clientId) await requireClientAccess(task.clientId);
  } catch (error) {
    return toErrorResponse(error);
  }

  const comment = await prisma.comment.create({
    data: { taskId, authorId: session.user.id, body: parsed.data.body },
    include: { author: { select: { id: true, name: true } } },
  });
  await logActivity({
    actorId: session.user.id,
    actorName: session.user.name ?? null,
    entityType: "Task",
    entityId: taskId,
    entityLabel: task?.title ?? taskId,
    clientId: task.clientId,
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
      title: `You were mentioned: "${task?.title ?? "a task"}"`,
      lines: [`By ${session.user.name ?? "someone"}`, `"${excerpt(parsed.data.body)}"`],
      linkPath,
    });
  }

  for (const a of task?.assignees ?? []) {
    if (a.teamMemberId === session.user.id || mentionedIds.has(a.teamMemberId)) continue;
    await notify({
      recipientId: a.teamMemberId,
      type: "COMMENTED",
      entityType: "Task",
      entityId: taskId,
      entityLabel: task!.title,
      title: `New comment: "${task!.title}"`,
      lines: [`By ${session.user.name ?? "someone"}`, `"${excerpt(parsed.data.body)}"`],
      linkPath,
    });
  }

  if (!task.isPrivate) {
    await notifyChannel({
      clientId: task.clientId,
      title: `New comment: "${task.title}"`,
      lines: [`By ${session.user.name ?? "someone"}`, `"${excerpt(parsed.data.body)}"`],
      linkPath,
    });
  }

  return NextResponse.json(comment, { status: 201 });
}
