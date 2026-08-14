import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { notify, notifyChannel } from "@/lib/notify";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { extractMentionedTeamMemberIds, stripHtml } from "@/lib/text-format";
import { deadlineLine } from "@/lib/utils";

function excerpt(text: string, max = 80): string {
  const plain = stripHtml(text);
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

const createCommentSchema = z.object({
  // Stores Tiptap-produced HTML (bold/lists/@mentions) — 20000 covers the
  // markup overhead the same way Task.description's limit was raised.
  body: z.string().trim().min(1, "Comment can't be empty").max(20000),
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
      deadline: true,
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

  // @mentions come from the RichTextEditor's Mention node (data-id spans) —
  // cross-check against real team members so tampered HTML can't fire a
  // notification for (or a Prisma FK error on) a fabricated id.
  const validTeamMemberIds = new Set(
    (await prisma.teamMember.findMany({ select: { id: true } })).map((m) => m.id)
  );
  const mentionedIds = new Set(
    extractMentionedTeamMemberIds(parsed.data.body).filter(
      (id) => id !== session.user.id && validTeamMemberIds.has(id)
    )
  );
  for (const id of mentionedIds) {
    await notify({
      recipientId: id,
      type: "MENTIONED",
      entityType: "Task",
      entityId: taskId,
      entityLabel: task?.title ?? taskId,
      title: `You were mentioned: "${task?.title ?? "a task"}"`,
      lines: [`By ${session.user.name ?? "someone"}`, `"${excerpt(parsed.data.body)}"`, ...deadlineLine(task?.deadline)],
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
      lines: [`By ${session.user.name ?? "someone"}`, `"${excerpt(parsed.data.body)}"`, ...deadlineLine(task!.deadline)],
      linkPath,
    });
  }

  if (!task.isPrivate) {
    await notifyChannel({
      clientId: task.clientId,
      title: `New comment: "${task.title}"`,
      lines: [`By ${session.user.name ?? "someone"}`, `"${excerpt(parsed.data.body)}"`, ...deadlineLine(task.deadline)],
      linkPath,
    });
  }

  return NextResponse.json(comment, { status: 201 });
}
