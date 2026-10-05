import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { requireCapability, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/utils";
import { issueToTaskSchema } from "@/lib/validations/leadership";

// "Turn into task" — creates a real, visible Task from an issue (the dialog
// defaults the due date to one week out). The issue stays on the list with a
// link to its task until someone marks it solved. Assignees get the normal
// ASSIGNED DM; there's deliberately no channel post, since issues are
// leadership-only and the channel reaches the wider team.
export async function POST(request: Request, { params }: { params: Promise<{ issueId: string }> }) {
  const session = await auth();
  try {
    await requireCapability("canUseLeadership");
  } catch (error) {
    return toErrorResponse(error);
  }
  const { issueId } = await params;
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, archivedAt: null },
    include: { recommendations: { where: { isDecision: true }, select: { body: true } } },
  });
  if (!issue) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = issueToTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const assigneeIds = [...new Set(parsed.data.assigneeIds)];
  // Same storage convention as a deadline picked in the task UI's date input
  // (new-task-input / task-detail-panel): that calendar date at UTC midnight.
  const deadline = new Date(parsed.data.deadline);

  const decision = issue.recommendations[0]?.body;
  const description = [issue.description, decision ? `Decision: ${decision}` : null].filter(Boolean).join("\n\n") || null;

  const task = await prisma.task.create({
    data: {
      title: issue.title,
      description,
      clientId: issue.clientId,
      kind: "TASK",
      statusId: "NEXT_UP",
      deadline,
      createdById: session?.user?.id ?? null,
      assignees: { create: assigneeIds.map((teamMemberId) => ({ teamMemberId })) },
    },
  });
  await prisma.issue.update({ where: { id: issueId }, data: { convertedTaskId: task.id } });

  const linkPath = task.clientId ? `/clients/${task.clientId}/tasks?taskId=${task.id}` : `/tasks?taskId=${task.id}`;
  for (const recipientId of assigneeIds) {
    if (recipientId === session?.user?.id) continue;
    await notify({
      recipientId,
      type: "ASSIGNED",
      entityType: "Task",
      entityId: task.id,
      entityLabel: task.title,
      title: `You're assigned: "${task.title}"`,
      lines: [`Assigned by ${session?.user?.name ?? "someone"}`, "From the Issues List", `Deadline: ${formatDate(deadline)}`],
      linkPath,
    });
  }

  return NextResponse.json({ task: { id: task.id, clientId: task.clientId } }, { status: 201 });
}
