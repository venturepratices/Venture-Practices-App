import { NextResponse } from "next/server";

import { logActivity } from "@/lib/activity-log";
import { getCompleteStatusId } from "@/lib/task-status";
import { getPriorityLevelOptions } from "@/lib/priority-level";
import { computeTargetPriorityLevel, shouldEscalate } from "@/lib/priority-auto-escalate";
import { prisma } from "@/lib/prisma";
import { daysUntilDue } from "@/lib/utils";

// Prisma + the Neon WebSocket driver require the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily pass that bumps a task's priority up as its deadline approaches,
 * per each PriorityLevelOption's admin-configured autoApplyDaysBeforeDue
 * (see that field in prisma/schema.prisma and Settings → Priority Levels).
 * Escalation only ever raises priority, never lowers it — see
 * src/lib/priority-auto-escalate.ts for the exact rule, confirmed with the
 * user: a person can always manually set it back down, and this cron will
 * simply re-raise it on its next run if the task is still within a
 * configured window. Skips completed tasks and tasks with no deadline.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const levels = await getPriorityLevelOptions();
  const escalationLevels = levels.map((l) => ({
    id: l.id,
    sequenceNumber: l.sequenceNumber,
    autoApplyDaysBeforeDue: l.autoApplyDaysBeforeDue,
  }));

  // Nothing configured — every level's trigger is off. Skip the task query
  // entirely rather than doing a full-table pass for no possible effect.
  if (escalationLevels.every((l) => l.autoApplyDaysBeforeDue == null)) {
    return NextResponse.json({ ok: true, configured: false, checked: 0, escalated: 0 });
  }

  const completeStatusId = await getCompleteStatusId();
  const sequenceById = new Map(escalationLevels.map((l) => [l.id, l.sequenceNumber]));

  const tasks = await prisma.task.findMany({
    where: { deadline: { not: null }, statusId: { not: completeStatusId } },
    select: { id: true, title: true, clientId: true, deadline: true, priorityLevelId: true },
  });

  // Group by target level so each escalation is one updateMany, not one
  // query per task.
  const idsByTargetLevel = new Map<string, string[]>();
  const escalatedTasks: { id: string; title: string; clientId: string | null; fromLabel: string; toLabel: string; days: number }[] = [];

  for (const task of tasks) {
    const days = daysUntilDue(task.deadline!);
    const target = computeTargetPriorityLevel(escalationLevels, days);
    const currentSequence = task.priorityLevelId ? (sequenceById.get(task.priorityLevelId) ?? null) : null;
    if (!shouldEscalate(target, currentSequence)) continue;

    const fromLabel = task.priorityLevelId ? (levels.find((l) => l.id === task.priorityLevelId)?.label ?? "no priority") : "no priority";
    const toLabel = levels.find((l) => l.id === target.id)!.label;

    const list = idsByTargetLevel.get(target.id) ?? [];
    list.push(task.id);
    idsByTargetLevel.set(target.id, list);
    escalatedTasks.push({ id: task.id, title: task.title, clientId: task.clientId, fromLabel, toLabel, days });
  }

  for (const [levelId, ids] of idsByTargetLevel) {
    await prisma.task.updateMany({ where: { id: { in: ids } }, data: { priorityLevelId: levelId } });
  }

  for (const t of escalatedTasks) {
    await logActivity({
      actorId: null,
      actorName: null,
      entityType: "Task",
      entityId: t.id,
      entityLabel: t.title,
      clientId: t.clientId,
      action: "updated",
      description: `Priority automatically escalated from ${t.fromLabel} to ${t.toLabel} (due in ${t.days} day${t.days === 1 ? "" : "s"})`,
    });
  }

  return NextResponse.json({ ok: true, configured: true, checked: tasks.length, escalated: escalatedTasks.length });
}
